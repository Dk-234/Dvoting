"""
Liveness Detection Microservice

A Flask-based microservice that analyzes frames from a video capture
to determine whether the subject is a live person (not a photo/replay).

Uses OpenCV and MediaPipe (Tasks API) for:
- Face landmark detection (FaceLandmarker)
- Blink detection (Eye Aspect Ratio)
- Head pose estimation (yaw/pitch)
- Texture analysis (Laplacian variance for detecting printed photos)

Endpoint: POST /detect-liveness
Input: JSON with { "frames": [base64_image_string, ...] }
Output: JSON with { "isLive": bool, "confidence": float, "blinks": int, "headMovement": bool, "details": {...} }

Usage:
    pip install -r requirements.txt
    python app.py
"""

import os
import sys
import base64
import time
import hmac
import hashlib
import logging
import urllib.request
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from flask import Flask, request, jsonify
from flask_cors import CORS

# ─── Configuration ───────────────────────────────────────

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB
CORS(app, origins=os.environ.get(
    'ALLOWED_ORIGINS',
    'http://localhost:3001,http://127.0.0.1:3001,http://localhost:5500'
).split(','))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# Secret for signing liveness tokens (set via env var in production)
LIVENESS_SECRET = os.environ.get('LIVENESS_SECRET', 'dev-liveness-secret-change-in-prod')

# Thresholds (tunable)
EAR_THRESHOLD = 0.21          # Eye Aspect Ratio below this = blink
EAR_CONSEC_FRAMES = 2         # Consecutive frames below threshold = confirmed blink
HEAD_YAW_THRESHOLD = 8.0      # Degrees of yaw change to count as movement
HEAD_PITCH_THRESHOLD = 6.0    # Degrees of pitch change to count as movement
LAPLACIAN_THRESHOLD = 50.0    # Below this = likely a printed photo
MIN_BLINKS = 1                # Minimum blinks required
MIN_CONFIDENCE = 0.6          # Minimum overall liveness confidence


# ─── MediaPipe Tasks API Setup ───────────────────────────

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "face_landmarker.task"


def download_model():
    """Download the FaceLandmarker model if it doesn't exist."""
    if MODEL_PATH.exists():
        logger.info(f"Face landmarker model already exists at {MODEL_PATH}")
        return
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Downloading face landmarker model to {MODEL_PATH}...")
    urllib.request.urlretrieve(MODEL_URL, str(MODEL_PATH))
    logger.info("Model downloaded successfully.")


# Download model at import time
download_model()

# Landmark indices for eyes (MediaPipe 468-point face mesh)
LEFT_EYE_IDX = [362, 385, 387, 263, 373, 380]
RIGHT_EYE_IDX = [33, 160, 158, 133, 153, 144]

# Nose tip and chin for head pose
NOSE_TIP = 1
CHIN = 152
LEFT_EYE_CORNER = 263
RIGHT_EYE_CORNER = 33
LEFT_MOUTH = 287
RIGHT_MOUTH = 57


# ─── Helper Functions ────────────────────────────────────

def decode_base64_frame(b64_string):
    """Decode a base64-encoded image string to an OpenCV BGR image."""
    try:
        img_bytes = base64.b64decode(b64_string)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        logger.warning(f"Failed to decode frame: {e}")
        return None


def compute_ear(landmarks, eye_indices, w, h):
    """
    Compute Eye Aspect Ratio (EAR) for one eye.

    EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)

    Where p1-p6 are the 6 eye landmark points.
    """
    pts = []
    for idx in eye_indices:
        lm = landmarks[idx]
        pts.append((lm.x * w, lm.y * h))

    if len(pts) < 6:
        return 0.3  # default open-eye

    def dist(a, b):
        return np.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)

    # Vertical distances
    v1 = dist(pts[1], pts[5])
    v2 = dist(pts[2], pts[4])
    # Horizontal distance
    horiz = dist(pts[0], pts[3])

    if horiz == 0:
        return 0.3

    return (v1 + v2) / (2.0 * horiz)


def estimate_head_pose(landmarks, w, h):
    """
    Estimate head yaw and pitch using the nose tip,
    eye corners, chin, and mouth corners as reference points.

    Returns (yaw, pitch) in approximate degrees.
    """
    # 2D image points
    image_points = np.array([
        (landmarks[NOSE_TIP].x * w, landmarks[NOSE_TIP].y * h),
        (landmarks[CHIN].x * w, landmarks[CHIN].y * h),
        (landmarks[LEFT_EYE_CORNER].x * w, landmarks[LEFT_EYE_CORNER].y * h),
        (landmarks[RIGHT_EYE_CORNER].x * w, landmarks[RIGHT_EYE_CORNER].y * h),
        (landmarks[LEFT_MOUTH].x * w, landmarks[LEFT_MOUTH].y * h),
        (landmarks[RIGHT_MOUTH].x * w, landmarks[RIGHT_MOUTH].y * h),
    ], dtype=np.float64)

    # 3D model points (generic face model)
    model_points = np.array([
        (0.0, 0.0, 0.0),          # Nose tip
        (0.0, -330.0, -65.0),     # Chin
        (-225.0, 170.0, -135.0),  # Left eye corner
        (225.0, 170.0, -135.0),   # Right eye corner
        (-150.0, -150.0, -125.0), # Left mouth corner
        (150.0, -150.0, -125.0),  # Right mouth corner
    ], dtype=np.float64)

    # Camera matrix (approximate)
    focal_length = w
    center = (w / 2, h / 2)
    camera_matrix = np.array([
        [focal_length, 0, center[0]],
        [0, focal_length, center[1]],
        [0, 0, 1]
    ], dtype=np.float64)

    dist_coeffs = np.zeros((4, 1))

    success, rotation_vector, translation_vector = cv2.solvePnP(
        model_points, image_points, camera_matrix, dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE
    )

    if not success:
        return 0.0, 0.0

    # Convert rotation vector to Euler angles
    rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
    sy = np.sqrt(rotation_matrix[0, 0] ** 2 + rotation_matrix[1, 0] ** 2)

    if sy > 1e-6:
        pitch = np.degrees(np.arctan2(rotation_matrix[2, 1], rotation_matrix[2, 2]))
        yaw = np.degrees(np.arctan2(-rotation_matrix[2, 0], sy))
    else:
        pitch = np.degrees(np.arctan2(-rotation_matrix[1, 2], rotation_matrix[1, 1]))
        yaw = np.degrees(np.arctan2(-rotation_matrix[2, 0], sy))

    return yaw, pitch


def compute_texture_score(gray_image):
    """
    Compute Laplacian variance as a measure of image texture/sharpness.
    Real faces have more micro-texture than printed photos or screens.
    """
    laplacian = cv2.Laplacian(gray_image, cv2.CV_64F)
    return laplacian.var()


def generate_liveness_token(is_live, confidence):
    """
    Generate an HMAC-signed token that the backend can verify.
    Proves that a legitimate liveness check was performed.
    """
    timestamp = str(int(time.time()))
    payload = f"{is_live}:{confidence:.4f}:{timestamp}"
    signature = hmac.new(
        LIVENESS_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return f"{payload}:{signature}"


# ─── Main Detection Endpoint ─────────────────────────────

@app.route('/detect-liveness', methods=['POST'])
def detect_liveness():
    """
    Analyze a set of base64-encoded frames for liveness.

    Request body (JSON):
        { "frames": ["base64_image_1", "base64_image_2", ...] }

    Response (JSON):
        {
          "isLive": true/false,
          "confidence": 0.0-1.0,
          "blinks": int,
          "headMovement": true/false,
          "textureOk": true/false,
          "facesDetected": int,
          "token": "signed_token_string",
          "details": { ... }
        }
    """
    data = request.get_json()

    if not data or 'frames' not in data:
        return jsonify({
            'error': 'Missing "frames" field in request body',
            'isLive': False,
            'confidence': 0.0
        }), 400

    raw_frames = data['frames']
    if not isinstance(raw_frames, list) or len(raw_frames) < 2:
        return jsonify({
            'error': 'At least 2 frames are required',
            'isLive': False,
            'confidence': 0.0
        }), 400

    if len(raw_frames) > 30:
        raw_frames = raw_frames[:30]  # Cap at 30 frames

    logger.info(f"Received {len(raw_frames)} frames for liveness detection")

    # Decode frames
    frames = []
    for i, b64 in enumerate(raw_frames):
        img = decode_base64_frame(b64)
        if img is not None:
            frames.append(img)
        else:
            logger.warning(f"Skipping invalid frame {i}")

    if len(frames) < 2:
        return jsonify({
            'error': 'Could not decode enough valid frames',
            'isLive': False,
            'confidence': 0.0
        }), 400

    logger.info(f"Decoded {len(frames)} valid frames, first frame shape: {frames[0].shape}")

    try:
        result = _analyze_frames(frames)
        return jsonify(result)
    except Exception as e:
        logger.exception(f"Liveness analysis error: {e}")
        return jsonify({
            'error': f'Analysis failed: {str(e)}',
            'isLive': False,
            'confidence': 0.0
        }), 500


def _analyze_frames(frames):
    """Run the actual liveness analysis pipeline. Separated for error handling."""
    blink_count = 0
    ear_below_threshold = 0
    yaw_values = []
    pitch_values = []
    texture_scores = []
    faces_detected = 0
    total_frames = len(frames)

    # Create FaceLandmarker using the Tasks API
    base_options = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = mp_vision.FaceLandmarkerOptions(
        base_options=base_options,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
    )

    with mp_vision.FaceLandmarker.create_from_options(options) as landmarker:
        for i, frame in enumerate(frames):
            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Convert to MediaPipe Image
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect(mp_image)

            if not result.face_landmarks or len(result.face_landmarks) == 0:
                continue

            faces_detected += 1
            landmarks = result.face_landmarks[0]  # list of NormalizedLandmark

            # 1) Eye Aspect Ratio (blink detection)
            left_ear = compute_ear(landmarks, LEFT_EYE_IDX, w, h)
            right_ear = compute_ear(landmarks, RIGHT_EYE_IDX, w, h)
            avg_ear = (left_ear + right_ear) / 2.0

            if avg_ear < EAR_THRESHOLD:
                ear_below_threshold += 1
            else:
                if ear_below_threshold >= EAR_CONSEC_FRAMES:
                    blink_count += 1
                ear_below_threshold = 0

            # 2) Head pose estimation
            yaw, pitch = estimate_head_pose(landmarks, w, h)
            yaw_values.append(yaw)
            pitch_values.append(pitch)

            # 3) Texture analysis
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            # Crop to face bounding box for texture analysis
            face_lms = [(lm.x * w, lm.y * h) for lm in landmarks]
            xs = [p[0] for p in face_lms]
            ys = [p[1] for p in face_lms]
            x_min = max(0, int(min(xs)) - 10)
            y_min = max(0, int(min(ys)) - 10)
            x_max = min(w, int(max(xs)) + 10)
            y_max = min(h, int(max(ys)) + 10)

            if x_max > x_min and y_max > y_min:
                face_roi = gray[y_min:y_max, x_min:x_max]
                tex_score = compute_texture_score(face_roi)
                texture_scores.append(tex_score)

    # Check for final blink at end of sequence
    if ear_below_threshold >= EAR_CONSEC_FRAMES:
        blink_count += 1

    # ── Scoring ──
    details = {}

    # Blink score
    blink_score = min(1.0, blink_count / max(1, MIN_BLINKS))
    details['blinks'] = blink_count
    details['blinkScore'] = round(blink_score, 3)

    # Head movement score
    head_movement = False
    yaw_range = 0.0
    pitch_range = 0.0
    if yaw_values:
        yaw_range = max(yaw_values) - min(yaw_values)
        pitch_range = max(pitch_values) - min(pitch_values)
        head_movement = yaw_range > HEAD_YAW_THRESHOLD or pitch_range > HEAD_PITCH_THRESHOLD

    head_score = 0.0
    if head_movement:
        head_score = min(1.0, (yaw_range + pitch_range) / (HEAD_YAW_THRESHOLD + HEAD_PITCH_THRESHOLD))

    details['yawRange'] = round(yaw_range, 2)
    details['pitchRange'] = round(pitch_range, 2)
    details['headScore'] = round(head_score, 3)

    # Texture score
    texture_ok = False
    avg_texture = 0.0
    if texture_scores:
        avg_texture = np.mean(texture_scores)
        texture_ok = avg_texture > LAPLACIAN_THRESHOLD

    texture_score = min(1.0, avg_texture / (LAPLACIAN_THRESHOLD * 3)) if avg_texture > 0 else 0.0
    details['avgTexture'] = round(avg_texture, 2)
    details['textureScore'] = round(texture_score, 3)

    # Face detection ratio
    detection_ratio = faces_detected / total_frames if total_frames > 0 else 0
    details['facesDetected'] = faces_detected
    details['detectionRatio'] = round(detection_ratio, 3)

    # Combined confidence
    # Weighted: blinks 30%, head movement 25%, texture 25%, face detection 20%
    confidence = (
        blink_score * 0.30 +
        head_score * 0.25 +
        texture_score * 0.25 +
        detection_ratio * 0.20
    )
    confidence = round(min(1.0, confidence), 4)

    is_live = confidence >= MIN_CONFIDENCE and faces_detected >= 2

    # Generate signed token
    token = generate_liveness_token(is_live, confidence)

    logger.info(
        f"Liveness result: isLive={is_live}, confidence={confidence}, "
        f"blinks={blink_count}, headMovement={head_movement}, "
        f"textureOk={texture_ok}, faces={faces_detected}/{total_frames}"
    )

    # Convert all numpy types to native Python types for JSON serialization
    return {
        'isLive': bool(is_live),
        'confidence': float(confidence),
        'blinks': int(blink_count),
        'headMovement': bool(head_movement),
        'textureOk': bool(texture_ok),
        'facesDetected': int(faces_detected),
        'totalFrames': int(total_frames),
        'token': str(token),
        'details': {k: (float(v) if isinstance(v, (np.floating, float)) else int(v) if isinstance(v, (np.integer, int)) else bool(v) if isinstance(v, (np.bool_, bool)) else v) for k, v in details.items()}
    }


@app.route('/verify-token', methods=['POST'])
def verify_token():
    """
    Verify a liveness token signature.
    Used by the Node.js backend to validate liveness results.
    
    Request: { "token": "payload:signature" }
    Response: { "valid": bool, "isLive": bool, "confidence": float, "timestamp": int }
    """
    data = request.get_json()
    token = data.get('token', '')

    parts = token.split(':')
    if len(parts) != 4:
        return jsonify({'valid': False, 'error': 'Invalid token format'}), 400

    is_live_str, confidence_str, timestamp_str, provided_sig = parts

    # Reconstruct and verify HMAC
    payload = f"{is_live_str}:{confidence_str}:{timestamp_str}"
    expected_sig = hmac.new(
        LIVENESS_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(provided_sig, expected_sig):
        return jsonify({'valid': False, 'error': 'Invalid signature'}), 401

    # Check token age (expire after 5 minutes)
    try:
        token_time = int(timestamp_str)
        if abs(time.time() - token_time) > 300:
            return jsonify({'valid': False, 'error': 'Token expired'}), 401
    except ValueError:
        return jsonify({'valid': False, 'error': 'Invalid timestamp'}), 400

    return jsonify({
        'valid': True,
        'isLive': is_live_str == 'True',
        'confidence': float(confidence_str),
        'timestamp': int(timestamp_str)
    })


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'service': 'Liveness Detection Microservice',
        'timestamp': int(time.time())
    })


# ─── Entry Point ──────────────────────────────────────────

if __name__ == '__main__':
    port = int(os.environ.get('LIVENESS_PORT', 5001))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'

    logger.info(f"Starting Liveness Detection Microservice on port {port}")
    app.run(host='0.0.0.0', port=port, debug=debug)
