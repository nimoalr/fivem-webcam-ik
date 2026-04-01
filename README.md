# fivem-webcam-ik

**Proof of Concept** — this is me messing around with webcam-driven ped animation in FiveM. it kinda works for arms but there's a lot of rough edges, see [limitations](#limitations).

It runs pose estimation via [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) in CEF, and moves your ped's arms in real time using GTAV's IK (Inverse Kinematics) natives.

## How it works

```
Webcam (getUserMedia in CEF)
  -> MediaPipe PoseLandmarker (WASM + WebGL in NUI browser)
    -> 33 body landmarks per frame
      -> NUI sends wrist + head positions to client via fetch()
        -> Client converts to world-space IK targets
          -> SetIkTarget() drives ped arms
```

Basically:
1. NUI page opens your webcam and runs MediaPipe pose estimation entirely in the CEF browser
2. Landmarks (wrists, shoulders, nose) get converted to direction vectors relative to the ped
3. Invisible snowball props get positioned in the world as IK targets
4. `SetIkTarget` makes the ped reach toward those props each frame

## Quick start

### Install

1. Drop the `fivem-webcam-ik` folder into your server's `resources/`
2. Add to your server configuration file:
   ```
   ensure fivem-webcam-ik
   ```
3. Restart your server or use the `refresh` + `start fivem-webcam-ik` commands

No build step. No dependencies. No framework. Just plain JS/HTML/CSS.

### Usage

1. `/webcam` in chat (or `webcam` in F8 console) — opens the webcam control panel
2. **Start Webcam** -> grants camera access
3. **Start Pose** -> loads the MediaPipe model (~5MB), you'll see a skeleton overlay on your feed
4. **Send to IK** -> ped arms start following your movements

The webcam command and control panel work as a two-layer system:

- **Close button (×)** — hides the panel and returns game focus, but the webcam, pose detection, and IK all keep running in the background. Your ped continues to follow your movements.
- **`/webcam` while hidden** — brings the panel back so you can adjust settings or monitor the feed. No restart needed.
- **`/webcam` while panel is visible** — hides the panel (same as clicking ×).
- **Stop All button** — fully shuts everything down: stops the webcam stream, pose detection, animation loop on the NUI side, and tears down the IK tick, props, and state on the client side. After this, `/webcam` starts fresh.

### Keyboard mode

`/ikpuppet` if you just want to mess with IK without a webcam:

| Key | What it does |
|-----|-------------|
| Arrow keys | Move the active limb around |
| Numpad +/- | Up/down |
| F5 / F6 / F7 | Switch between right arm / left arm / head |
| `/ikpuppet` | Toggle off |

## Limitations

This is a PoC and FiveM scripting engine does not expose natives to control bones individually, so we use the Inverse Kinetics native instead.

- **Arms only, really** — GTAV IK has 3 channels: head (1), left arm (3), right arm (4). No legs, torso, or fingers.
- **No finger control** — finger bones exist in the skeleton but they're read-only at runtime. finger poses come from animation clips only.
- **Positions, not rotations** — you tell the engine where the hand should reach, not how the wrist should be oriented. the engine figures out the joint angles.
- **Head IK doesn't work yet** — it's implemented in the code but i haven't been able to get any visible effect from `SetIkTarget` on the head channel. might need a specific ped task state or animation that i haven't figured out. PRs welcome lol.

## How it's built

### The IK approach

```js
// create invisible prop as IK target
const prop = CreateObject(GetHashKey('w_ex_snowball'), x, y, z, false, false, false);
SetEntityAlpha(prop, 0, false);
SetEntityCollision(prop, false, false);

// move prop to desired hand position each frame
SetEntityCoordsNoOffset(prop, targetX, targetY, targetZ, false, false, false);

// drive arm toward the prop 
SetIkTarget(PlayerPedId(), 4, prop, 0, 0.0, 0.0, 0.0, 64, 0, 0);
```

### Pose-to-IK math

MediaPipe gives normalized landmarks (x: 0-1 left-right, y: 0-1 top-bottom, z: depth in meters). converting to ped-relative IK directions:

**Arms** (shoulder-to-wrist vector):
```
pedX = -dx * 8.0    // horizontal (mirrored for webcam flip)
pedZ = -dy * 4.0    // vertical
pedY = 0.3 - dz * 2 // forward/back from depth
```

**Head** (nose offset from shoulder midpoint):
```
headX = -noseDx * 20.0       // horizontal turn
headY = 10.0                  // forward (constant)
headZ = -noseDy * 10.0 + 2.0 // vertical tilt
```

The multipliers are just what felt okay during testing. tweak them in `ui/app.js` (`wristToDir` function) if the amplitude feels off.

## License

Code is MIT. do whatever you want with it.

The bundled MediaPipe model and WASM files are [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) by Google.
