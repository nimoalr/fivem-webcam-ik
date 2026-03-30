fx_version 'cerulean'
game 'gta5'

name 'fivem-webcam-ik'
description 'Webcam-to-IK puppet system using MediaPipe pose estimation'
author 'Nimoa'
version '1.0.0'

client_script 'client.js'

ui_page 'ui/index.html'

files {
    'ui/index.html',
    'ui/style.css',
    'ui/app.js',
    'ui/vision_bundle.mjs',
    'ui/mediapipe/pose_landmarker_lite.task',
    'ui/mediapipe/wasm/vision_wasm_internal.js',
    'ui/mediapipe/wasm/vision_wasm_internal.wasm',
    'ui/mediapipe/wasm/vision_wasm_nosimd_internal.js',
    'ui/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
}
