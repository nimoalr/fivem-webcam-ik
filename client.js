// =============================================================================
// fivem-webcam-ik — Standalone webcam-to-IK puppet resource
//
// /webcam  — Toggle webcam + pose estimation + IK puppet mode
//
// Uses invisible snowball prop entities as IK targets.
// Player is frozen while active (locomotion overrides IK otherwise).
// =============================================================================

let ikPuppetTick = null;
let ikRightProp = null;
let ikLeftProp = null;

const IK_DEFAULTS = {
    rightArm: { x: 0.3, y: 0.5, z: 0.0 },
    leftArm:  { x: -0.3, y: 0.5, z: 0.0 },
    head:     { x: 0.0, y: 10.0, z: 0.0 },
};

const ikState = {
    active: false,
    rightArm:    { x: 0.3, y: 0.5, z: 0.0 },
    leftArm:     { x: -0.3, y: 0.5, z: 0.0 },
    head:        { x: 0.0, y: 10.0, z: 0.0 },
    smoothRight: { x: 0.3, y: 0.5, z: 0.0 },
    smoothLeft:  { x: -0.3, y: 0.5, z: 0.0 },
    smoothHead:  { x: 0.0, y: 10.0, z: 0.0 },
    selectedLimb: 'rightArm', // 'rightArm' | 'leftArm' | 'head'
    poseMode: false,
    speed: 0.03,
    smoothFactor: 0.25,
};

let ikLogCounter = 0;
let ikReceivingData = false;

// --- Utilities ---

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function lerpDir(current, target, t) {
    return {
        x: current.x + (target.x - current.x) * t,
        y: current.y + (target.y - current.y) * t,
        z: current.z + (target.z - current.z) * t,
    };
}

function copyDir(d) {
    return { x: d.x, y: d.y, z: d.z };
}

// --- NUI Callbacks ---

RegisterNuiCallback('uc::ikPuppet::poseLandmarks', (data, cb) => {
    if (!ikState.active || !ikState.poseMode) { cb('ok'); return; }
    ikState.rightArm = data.rightArm;
    ikState.leftArm = data.leftArm;
    ikState.head = data.head;
    if (!ikReceivingData) {
        ikReceivingData = true;
        console.log('[IK] First pose data received');
    }
    ikLogCounter++;
    if (ikLogCounter % 30 === 0) {
        const f = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
        console.log(`[IK RECV] R:${f(data.rightArm)} L:${f(data.leftArm)} H:${f(data.head)}`);
    }
    cb('ok');
});

RegisterNuiCallback('uc::webcamDebug::close', (_data, cb) => {
    SetNuiFocus(false, false);
    cb('ok');
});

// --- Prop management ---

async function createIkProp(ped) {
    const propHash = GetHashKey('w_ex_snowball');
    RequestModel(propHash);
    let timeout = 0;
    while (!HasModelLoaded(propHash) && timeout < 2000) {
        await delay(10);
        timeout += 10;
    }
    const coords = GetEntityCoords(ped, true);
    const prop = CreateObject(propHash, coords[0], coords[1], coords[2], false, false, false);
    SetEntityAlpha(prop, 0, false);
    SetEntityCollision(prop, false, false);
    SetModelAsNoLongerNeeded(propHash);
    return prop;
}

function deleteIkProp(prop) {
    if (prop !== null && DoesEntityExist(prop)) {
        DeleteEntity(prop);
    }
    return null;
}

// --- Start / Stop ---

function stopIkPuppet() {
    const ped = PlayerPedId();
    ikState.active = false;
    ikState.poseMode = false;
    ikReceivingData = false;
    ikLogCounter = 0;
    FreezeEntityPosition(ped, false);
    if (ikPuppetTick !== null) { clearTick(ikPuppetTick); ikPuppetTick = null; }
    ikRightProp = deleteIkProp(ikRightProp);
    ikLeftProp = deleteIkProp(ikLeftProp);
    ikState.rightArm    = copyDir(IK_DEFAULTS.rightArm);
    ikState.leftArm     = copyDir(IK_DEFAULTS.leftArm);
    ikState.head        = copyDir(IK_DEFAULTS.head);
    ikState.smoothRight = copyDir(IK_DEFAULTS.rightArm);
    ikState.smoothLeft  = copyDir(IK_DEFAULTS.leftArm);
    ikState.smoothHead  = copyDir(IK_DEFAULTS.head);
}

async function startIkPuppetTick() {
    if (ikPuppetTick !== null) return;

    const ped = PlayerPedId();
    SetPedCanArmIk(ped, true);
    SetPedCanHeadIk(ped, true);
    FreezeEntityPosition(ped, true);
    console.log('[IK] Player frozen for IK control');

    ikRightProp = await createIkProp(ped);
    ikLeftProp = await createIkProp(ped);
    console.log(`[IK] Created IK prop entities: right=${ikRightProp} left=${ikLeftProp}`);

    let tickLogCounter = 0;

    ikPuppetTick = setTick(() => {
        const ped = PlayerPedId();
        if (!ikState.active || !DoesEntityExist(ped)) return;
        if (ikRightProp === null || ikLeftProp === null) return;

        // Disable all controls so locomotion doesn't fight IK
        DisableAllControlActions(0);

        if (!ikState.poseMode) {
            // --- Keyboard mode ---
            const speed = ikState.speed;
            const limb = ikState[ikState.selectedLimb];
            // Arrow keys
            if (IsDisabledControlPressed(0, 172) || IsControlPressed(0, 172)) limb.y += speed;
            if (IsDisabledControlPressed(0, 173) || IsControlPressed(0, 173)) limb.y -= speed;
            if (IsDisabledControlPressed(0, 174) || IsControlPressed(0, 174)) limb.x -= speed;
            if (IsDisabledControlPressed(0, 175) || IsControlPressed(0, 175)) limb.x += speed;
            // Numpad +/-
            if (IsControlPressed(0, 96)) limb.z += speed;
            if (IsControlPressed(0, 97)) limb.z -= speed;
            // F5/F6/F7 limb selection
            if (IsControlJustPressed(0, 166)) { ikState.selectedLimb = 'rightArm'; console.log('[IK] Right Arm'); }
            if (IsControlJustPressed(0, 167)) { ikState.selectedLimb = 'leftArm'; console.log('[IK] Left Arm'); }
            if (IsControlJustPressed(0, 168)) { ikState.selectedLimb = 'head'; console.log('[IK] Head'); }
            ikState.smoothRight = copyDir(ikState.rightArm);
            ikState.smoothLeft  = copyDir(ikState.leftArm);
            ikState.smoothHead  = copyDir(ikState.head);
        } else {
            // --- Pose mode: lerp for smoothing ---
            const t = ikState.smoothFactor;
            ikState.smoothRight = lerpDir(ikState.smoothRight, ikState.rightArm, t);
            ikState.smoothLeft  = lerpDir(ikState.smoothLeft,  ikState.leftArm,  t);
            ikState.smoothHead  = lerpDir(ikState.smoothHead,  ikState.head,     t);
        }

        // --- Ped transform ---
        const pedCoords = GetEntityCoords(ped, true);
        const pedHeading = GetEntityHeading(ped);
        const rad = pedHeading * (Math.PI / 180);
        const cosH = Math.cos(rad);
        const sinH = Math.sin(rad);

        // Convert ped-relative offset to world position
        const toWorld = (offset, zBase) => ({
            x: pedCoords[0] + offset.x * cosH - offset.y * sinH,
            y: pedCoords[1] + offset.x * sinH + offset.y * cosH,
            z: pedCoords[2] + zBase + offset.z,
        });

        // === ARMS (entity-based IK) ===
        const rightWorld = toWorld(ikState.smoothRight, 0.5);
        const leftWorld  = toWorld(ikState.smoothLeft,  0.5);

        SetEntityCoordsNoOffset(ikRightProp, rightWorld.x, rightWorld.y, rightWorld.z, false, false, false);
        SetEntityCoordsNoOffset(ikLeftProp,  leftWorld.x,  leftWorld.y,  leftWorld.z,  false, false, false);

        // Entity-based IK targeting with flag 64
        SetPedCanArmIk(ped, true);
        SetIkTarget(ped, 4, ikRightProp, 0, 0.0, 0.0, 0.0, 64, 0, 0);
        SetIkTarget(ped, 3, ikLeftProp,  0, 0.0, 0.0, 0.0, 64, 0, 0);

        // === HEAD ===
        const hd = ikState.smoothHead;
        SetIkTarget(ped, 1, ped, 0, hd.x, hd.y, hd.z, 0, 100, 100);

        // --- Debug logging ---
        tickLogCounter++;
        if (ikReceivingData && tickLogCounter % 120 === 0) {
            const f3 = (p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
            const fa = (arr) => `(${arr[0].toFixed(2)}, ${arr[1].toFixed(2)}, ${arr[2].toFixed(2)})`;
            const rHand = GetPedBoneCoords(ped, 57005, 0, 0, 0);
            const lHand = GetPedBoneCoords(ped, 18905, 0, 0, 0);
            const rShoulder = GetPedBoneCoords(ped, 0x9D4D, 0, 0, 0);
            console.log(`[IK] #${tickLogCounter} props: R=${DoesEntityExist(ikRightProp)} L=${DoesEntityExist(ikLeftProp)}`);
            console.log(`[IK] targets: R=${f3(rightWorld)} L=${f3(leftWorld)} H=(${hd.x.toFixed(1)},${hd.y.toFixed(1)},${hd.z.toFixed(1)})`);
            console.log(`[IK] bones: R_hand=${fa(rHand)} L_hand=${fa(lHand)}`);
            console.log(`[IK] shoulder->hand: (${(rHand[0]-rShoulder[0]).toFixed(2)}, ${(rHand[1]-rShoulder[1]).toFixed(2)}, ${(rHand[2]-rShoulder[2]).toFixed(2)})`);
        }

        // --- Debug markers ---
        const drawSphere = (pos, r, g, b, size) => {
            DrawMarker(28, pos.x, pos.y, pos.z, 0, 0, 0, 0, 0, 0, size, size, size, r, g, b, 180, false, false, 2, false, null, null, false);
        };
        drawSphere(rightWorld, 255, 80, 80, ikState.selectedLimb === 'rightArm' ? 0.1 : 0.05);
        drawSphere(leftWorld,  80,  80, 255, ikState.selectedLimb === 'leftArm'  ? 0.1 : 0.05);

        // --- HUD ---
        SetTextFont(0);
        SetTextScale(0.35, 0.35);
        SetTextColour(255, 255, 255, 255);
        SetTextOutline();
        SetTextEntry('STRING');
        const mode = ikState.poseMode ? '~g~POSE' : `~b~KBD ~w~${ikState.selectedLimb}`;
        AddTextComponentString(`~r~[IK Puppet]~w~ ${mode}`);
        DrawText(0.01, 0.01);
    });
}

// --- /webcam command ---

RegisterCommand('webcam', () => {
    if (ikState.active && ikState.poseMode) {
        // Turn off
        stopIkPuppet();
        console.log('[IK Puppet] Disabled');
        SendNuiMessage(JSON.stringify({ type: 'cu::webcamDebug::toggle' }));
        return;
    }

    if (!ikState.active) {
        // Start fresh in pose mode
        ikState.active = true;
        ikState.poseMode = true;
        startIkPuppetTick();
        console.log('[IK Puppet] Pose mode — waiting for webcam data');
    } else {
        // Already in keyboard mode, switch to pose
        ikState.poseMode = true;
        console.log('[IK Puppet] Switched to pose mode');
    }
    SetNuiFocus(true, true);
    SendNuiMessage(JSON.stringify({ type: 'cu::webcamDebug::toggle' }));
}, false);

// --- /ikpuppet command (keyboard-only mode) ---

RegisterCommand('ikpuppet', () => {
    if (ikState.active) {
        stopIkPuppet();
        console.log('[IK Puppet] Disabled');
        return;
    }
    ikState.active = true;
    ikState.poseMode = false;
    ikState.selectedLimb = 'rightArm';
    console.log('[IK Puppet] Keyboard mode');
    startIkPuppetTick();
}, false);

// --- Cleanup on resource stop ---

on('onResourceStop', (resourceName) => {
    if (resourceName !== GetCurrentResourceName()) return;
    if (ikState.active) {
        stopIkPuppet();
    }
});
