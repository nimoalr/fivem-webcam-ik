// =============================================================================
// fivem-webcam-ik — NUI App (vanilla JS)
//
// Webcam capture + MediaPipe pose estimation + landmark overlay + IK data send
// =============================================================================

// --- MediaPipe Landmark Indices ---
const LANDMARK = {
    NOSE: 0,
    LEFT_SHOULDER: 11,
    RIGHT_SHOULDER: 12,
    LEFT_ELBOW: 13,
    RIGHT_ELBOW: 14,
    LEFT_WRIST: 15,
    RIGHT_WRIST: 16,
    LEFT_HIP: 23,
    RIGHT_HIP: 24,
};

const SKELETON_CONNECTIONS = [
    [LANDMARK.LEFT_SHOULDER, LANDMARK.RIGHT_SHOULDER],
    [LANDMARK.LEFT_SHOULDER, LANDMARK.LEFT_ELBOW],
    [LANDMARK.LEFT_ELBOW, LANDMARK.LEFT_WRIST],
    [LANDMARK.RIGHT_SHOULDER, LANDMARK.RIGHT_ELBOW],
    [LANDMARK.RIGHT_ELBOW, LANDMARK.RIGHT_WRIST],
    [LANDMARK.LEFT_SHOULDER, LANDMARK.LEFT_HIP],
    [LANDMARK.RIGHT_SHOULDER, LANDMARK.RIGHT_HIP],
    [LANDMARK.LEFT_HIP, LANDMARK.RIGHT_HIP],
];

const LANDMARK_COLORS = {
    [LANDMARK.NOSE]: '#4caf50',
    [LANDMARK.LEFT_WRIST]: '#2196f3',
    [LANDMARK.RIGHT_WRIST]: '#f44336',
    [LANDMARK.LEFT_ELBOW]: '#64b5f6',
    [LANDMARK.RIGHT_ELBOW]: '#ef9a9a',
    [LANDMARK.LEFT_SHOULDER]: '#90caf9',
    [LANDMARK.RIGHT_SHOULDER]: '#ef5350',
};

// --- State ---
let visible = false;
let streaming = false;
let poseActive = false;
let sendingToIk = false;
let stream = null;
let poseLandmarker = null;
let animFrameId = null;
let poseFps = 0;
let lastLandmarks = {};
let _frameCount = 0;
let _fpsTimer = 0;
let _sendLogCounter = 0;

// --- DOM Elements ---
const overlay = document.getElementById('webcam-overlay');
const statusBar = document.getElementById('status-bar');
const video = document.getElementById('webcam-video');
const canvas = document.getElementById('overlay-canvas');
const poseInfo = document.getElementById('pose-info');
const poseHead = document.getElementById('pose-head');
const poseLWrist = document.getElementById('pose-lwrist');
const poseRWrist = document.getElementById('pose-rwrist');
const poseFpsEl = document.getElementById('pose-fps');
const poseSending = document.getElementById('pose-sending');
const infoDevice = document.getElementById('info-device');
const infoResolution = document.getElementById('info-resolution');
const infoError = document.getElementById('info-error');
const btnStartWebcam = document.getElementById('btn-start-webcam');
const btnStartPose = document.getElementById('btn-start-pose');
const btnToggleIk = document.getElementById('btn-toggle-ik');
const btnStopAll = document.getElementById('btn-stop-all');
const btnClose = document.getElementById('btn-close');

// --- API Support Display ---
document.getElementById('api-gum').textContent =
    'getUserMedia: ' + (!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? 'YES' : 'NO');

try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    document.getElementById('api-webgl').textContent =
        'WebGL: ' + (gl ? 'YES (WebGL' + (c.getContext('webgl2') ? '2' : '1') + ')' : 'NO');
} catch (e) {
    document.getElementById('api-webgl').textContent = 'WebGL: NO';
}

document.getElementById('api-wasm').textContent =
    'WASM: ' + (typeof WebAssembly !== 'undefined' ? 'YES' : 'NO');
document.getElementById('api-sab').textContent =
    'SharedArrayBuffer: ' + (typeof SharedArrayBuffer !== 'undefined' ? 'YES' : 'NO');
document.getElementById('api-protocol').textContent =
    'protocol: ' + window.location.protocol;

// --- Helpers ---

function fmt(v) {
    return v != null ? v.toFixed(3) : '---';
}

function setStatus(text, cls) {
    statusBar.textContent = text;
    statusBar.className = 'webcam-debug-status ' + cls;
}

function setError(msg) {
    infoError.textContent = msg || '';
}

// --- Webcam ---

async function startWebcam() {
    setError('');
    setStatus('Requesting webcam...', 'status-idle');

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
        });

        video.srcObject = stream;
        await new Promise((resolve) => { video.onloadedmetadata = resolve; });
        await video.play();

        streaming = true;
        setStatus('Webcam active', 'status-streaming');
        btnStartWebcam.disabled = true;
        btnStartPose.disabled = false;

        const track = stream.getVideoTracks()[0];
        if (track) {
            infoDevice.textContent = 'Device: ' + track.label;
            const settings = track.getSettings();
            infoResolution.textContent = 'Resolution: ' + settings.width + 'x' + settings.height;
            canvas.width = settings.width;
            canvas.height = settings.height;
        }
    } catch (err) {
        streaming = false;
        setError(err.name + ': ' + err.message);
        setStatus('Webcam failed', 'status-error');
        console.error('[WebcamDebug] getUserMedia error:', err);
    }
}

// --- Pose Detection ---

async function startPose() {
    if (!streaming) return;

    setError('');
    setStatus('Loading MediaPipe...', 'status-idle');

    try {
        // Dynamic import of the bundled vision module
        const vision = await import('./vision_bundle.mjs');
        const { PoseLandmarker, FilesetResolver } = vision;

        setStatus('Loading WASM fileset...', 'status-idle');

        // Resolve paths for NUI context
        const wasmBase = window.location.protocol === 'nui:'
            ? 'nui://fivem-webcam-ik/ui/mediapipe/wasm'
            : './mediapipe/wasm';

        const modelPath = window.location.protocol === 'nui:'
            ? 'nui://fivem-webcam-ik/ui/mediapipe/pose_landmarker_lite.task'
            : './mediapipe/pose_landmarker_lite.task';

        console.log('[WebcamDebug] WASM base:', wasmBase);
        console.log('[WebcamDebug] Model path:', modelPath);

        const fileset = await FilesetResolver.forVisionTasks(wasmBase);

        setStatus('Loading pose model...', 'status-idle');

        poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: {
                modelAssetPath: modelPath,
                delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
        });

        setStatus('Pose detection active', 'status-ok');
        poseActive = true;
        poseInfo.style.display = '';
        btnStartPose.disabled = true;
        btnToggleIk.disabled = false;
        _frameCount = 0;
        _fpsTimer = performance.now();

        detectLoop();
    } catch (err) {
        setError('Pose init failed: ' + err.message);
        setStatus('Pose failed', 'status-error');
        console.error('[WebcamDebug] Pose init error:', err);
    }
}

function detectLoop() {
    if (!poseActive || !poseLandmarker) return;

    if (!video || video.readyState < 2) {
        animFrameId = requestAnimationFrame(detectLoop);
        return;
    }

    const now = performance.now();
    const result = poseLandmarker.detectForVideo(video, now);

    // FPS counter
    _frameCount++;
    if (now - _fpsTimer >= 1000) {
        poseFps = _frameCount;
        _frameCount = 0;
        _fpsTimer = now;
        poseFpsEl.textContent = 'FPS: ' + poseFps;
    }

    if (result.landmarks && result.landmarks.length > 0) {
        const landmarks = result.landmarks[0];
        drawLandmarks(landmarks);
        extractKeyLandmarks(landmarks);

        if (sendingToIk) {
            sendLandmarksToClient();
        }
    } else {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    animFrameId = requestAnimationFrame(detectLoop);
}

// --- Drawing ---

function drawLandmarks(landmarks) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Skeleton connections
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    for (const [a, b] of SKELETON_CONNECTIONS) {
        const la = landmarks[a];
        const lb = landmarks[b];
        if (la.visibility > 0.5 && lb.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(la.x * w, la.y * h);
            ctx.lineTo(lb.x * w, lb.y * h);
            ctx.stroke();
        }
    }

    // Key landmarks as circles
    const keyIndices = [
        LANDMARK.NOSE,
        LANDMARK.LEFT_SHOULDER, LANDMARK.RIGHT_SHOULDER,
        LANDMARK.LEFT_ELBOW, LANDMARK.RIGHT_ELBOW,
        LANDMARK.LEFT_WRIST, LANDMARK.RIGHT_WRIST,
    ];
    for (const idx of keyIndices) {
        const lm = landmarks[idx];
        if (lm.visibility < 0.5) continue;

        const color = LANDMARK_COLORS[idx] || '#ffffff';
        const radius = (idx === LANDMARK.NOSE || idx === LANDMARK.LEFT_WRIST || idx === LANDMARK.RIGHT_WRIST) ? 8 : 5;

        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// --- Landmark extraction ---

function extractKeyLandmarks(landmarks) {
    lastLandmarks = {
        nose: landmarks[LANDMARK.NOSE],
        leftWrist: landmarks[LANDMARK.LEFT_WRIST],
        rightWrist: landmarks[LANDMARK.RIGHT_WRIST],
        leftShoulder: landmarks[LANDMARK.LEFT_SHOULDER],
        rightShoulder: landmarks[LANDMARK.RIGHT_SHOULDER],
        leftElbow: landmarks[LANDMARK.LEFT_ELBOW],
        rightElbow: landmarks[LANDMARK.RIGHT_ELBOW],
    };

    // Update display
    if (lastLandmarks.nose) {
        poseHead.textContent = 'Head: x=' + fmt(lastLandmarks.nose.x) + ' y=' + fmt(lastLandmarks.nose.y) + ' z=' + fmt(lastLandmarks.nose.z);
    }
    if (lastLandmarks.leftWrist) {
        poseLWrist.textContent = 'L Wrist: x=' + fmt(lastLandmarks.leftWrist.x) + ' y=' + fmt(lastLandmarks.leftWrist.y) + ' z=' + fmt(lastLandmarks.leftWrist.z);
    }
    if (lastLandmarks.rightWrist) {
        poseRWrist.textContent = 'R Wrist: x=' + fmt(lastLandmarks.rightWrist.x) + ' y=' + fmt(lastLandmarks.rightWrist.y) + ' z=' + fmt(lastLandmarks.rightWrist.z);
    }
}

// --- Send landmarks to client IK ---

function sendLandmarksToClient() {
    const lm = lastLandmarks;
    if (!lm.nose || !lm.leftWrist || !lm.rightWrist || !lm.leftShoulder || !lm.rightShoulder) return;

    const midX = (lm.leftShoulder.x + lm.rightShoulder.x) / 2;
    const midY = (lm.leftShoulder.y + lm.rightShoulder.y) / 2;

    const wristToDir = (wrist, shoulder) => {
        const dx = wrist.x - shoulder.x;
        const dy = wrist.y - shoulder.y;
        const dz = wrist.z - shoulder.z;

        const pedX = -dx * 8.0;
        const pedZ = -dy * 4.0;
        const pedY = 0.3 + (-dz * 2.0);

        return { x: pedX, y: Math.max(0.1, pedY), z: pedZ };
    };

    const rightArmDir = wristToDir(lm.rightWrist, lm.rightShoulder);
    const leftArmDir = wristToDir(lm.leftWrist, lm.leftShoulder);

    const noseDx = lm.nose.x - midX;
    const noseDy = lm.nose.y - midY;

    const headX = -noseDx * 20.0;
    const headY = 10.0;
    const headZ = -noseDy * 10.0 + 2.0;

    const payload = {
        rightArm: rightArmDir,
        leftArm: leftArmDir,
        head: { x: headX, y: headY, z: headZ },
    };

    // Debug log every 30 frames
    _sendLogCounter++;
    if (_sendLogCounter % 30 === 0) {
        const rDx = lm.rightWrist.x - lm.rightShoulder.x;
        const rDy = lm.rightWrist.y - lm.rightShoulder.y;
        const rDz = lm.rightWrist.z - lm.rightShoulder.z;

        const debugLog = {
            frame: _sendLogCounter,
            raw: {
                rightWrist: { x: lm.rightWrist.x, y: lm.rightWrist.y, z: lm.rightWrist.z, vis: lm.rightWrist.visibility },
                leftWrist: { x: lm.leftWrist.x, y: lm.leftWrist.y, z: lm.leftWrist.z, vis: lm.leftWrist.visibility },
                rightShoulder: { x: lm.rightShoulder.x, y: lm.rightShoulder.y, z: lm.rightShoulder.z },
                leftShoulder: { x: lm.leftShoulder.x, y: lm.leftShoulder.y, z: lm.leftShoulder.z },
                nose: { x: lm.nose.x, y: lm.nose.y, z: lm.nose.z },
                midShoulder: { x: midX, y: midY },
            },
            rArmMath: {
                shoulderToWristDelta: { dx: rDx, dy: rDy, dz: rDz },
                pedMapping: { pedX: -rDx * 3.0, pedZ: -rDy * 2.0, pedY: 1.0 + (-rDz * 2.0) },
            },
            output: payload,
        };
        console.log('[POSE DEBUG] ' + JSON.stringify(debugLog));
    }

    // Send to client via NUI callback
    fetch('https://fivem-webcam-ik/uc::ikPuppet::poseLandmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).catch(() => {});
}

// --- Toggle IK sending ---

function toggleIkSend() {
    sendingToIk = !sendingToIk;
    btnToggleIk.textContent = sendingToIk ? 'Stop IK' : 'Send to IK';
    poseSending.textContent = sendingToIk ? 'YES' : 'NO';
    poseSending.className = sendingToIk ? 'status-ok' : 'status-idle';
    if (sendingToIk) {
        console.log('[WebcamDebug] Now sending landmarks to IK puppet');
    }
}

// --- Stop all ---

function stopAll() {
    poseActive = false;
    sendingToIk = false;
    _sendLogCounter = 0;

    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    if (poseLandmarker) {
        poseLandmarker.close();
        poseLandmarker = null;
    }
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }
    video.srcObject = null;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    streaming = false;
    poseFps = 0;
    lastLandmarks = {};

    infoDevice.textContent = '';
    infoResolution.textContent = '';
    poseInfo.style.display = 'none';
    poseSending.textContent = 'NO';
    poseSending.className = 'status-idle';
    btnStartWebcam.disabled = false;
    btnStartPose.disabled = true;
    btnToggleIk.disabled = true;
    btnToggleIk.textContent = 'Send to IK';

    if (visible) setStatus('Stopped', 'status-idle');
}

function close() {
    stopAll();
    visible = false;
    overlay.style.display = 'none';

    fetch('https://fivem-webcam-ik/uc::webcamDebug::close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    }).catch(() => {});
}

// --- Event Listeners ---

btnStartWebcam.addEventListener('click', startWebcam);
btnStartPose.addEventListener('click', startPose);
btnToggleIk.addEventListener('click', toggleIkSend);
btnStopAll.addEventListener('click', stopAll);
btnClose.addEventListener('click', close);

// Listen for toggle message from client script
window.addEventListener('message', (event) => {
    if (!event.data || !event.data.type) return;

    if (event.data.type === 'cu::webcamDebug::toggle') {
        visible = !visible;
        overlay.style.display = visible ? '' : 'none';
        if (visible) {
            setStatus('Ready', 'status-idle');
            setError('');
        } else {
            stopAll();
        }
    }
});
