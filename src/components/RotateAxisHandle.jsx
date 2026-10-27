import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

const CANON_AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];
// Scratch vectors reused every frame for the icon foreshortening math below,
// instead of allocating new THREE.Vector3s 60x/sec per badge.
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _helperY = new THREE.Vector3(0, 1, 0);
const _helperX = new THREE.Vector3(1, 0, 0);
const _ringU = new THREE.Vector3();
const _ringV = new THREE.Vector3();
const MARGIN_MIN = 2; // inches — minimum stand-off beyond the board/AABB face
const MARGIN_RATIO = 0.2;
const BADGE_SIZE = 30; // px — fixed regardless of zoom, so there's only ever one unambiguous size to grab
const PILL_HEIGHT = 54; // px — the badge stretches into this while actively dragging
const TAIL_LENGTH = 22; // px
// The live angle readout lights up whenever it passes within this tolerance
// of a "standard" angle (0°, 45°, 90°, 135°...), so you can feel/see when
// you've hit one without being locked to it.
const STANDARD_ANGLE_STEP = 45;
const STANDARD_ANGLE_TOLERANCE = 1; // degrees

// Material Symbols "autorenew" glyph — a crisp two-arc rotate icon (each arc
// its own arrowhead, rotationally symmetric) instead of relying on the
// Unicode ⟳ character, which renders inconsistently thin/blurry across
// platforms. Matches the clean, unmistakable icon style used by apps like
// Make.by.me for their rotate handles.
const RotateIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 -960 960 960" fill={color} aria-hidden="true">
    <path d="M204-318q-22-38-33-78t-11-82q0-134 93-228t227-94h7l-64-64 56-56 160 160-160 160-56-56 64-64h-7q-100 0-170 70.5T240-478q0 26 6 51t18 49l-60 60ZM481-40 321-200l160-160 56 56-64 64h7q100 0 170-70.5T720-482q0-26-6-51t-18-49l60-60q22 38 33 78t11 82q0 134-93 228t-227 94h-7l64 64-56 56Z" />
  </svg>
);

/**
 * One draggable rotate badge for a single axis (X/Y/Z) — styled after the
 * discrete per-axis handles apps like Make.by.me use instead of a single 3D
 * ring sphere. Three of these render together (see TransformGizmo), one per
 * axis, color/label-matched to the existing Local Orientation inspector
 * buttons (Tilt Front/Back = X, Spin Flat = Y, Tilt Left/Right = Z) so the
 * same axis always means the same thing everywhere in the app. The drag
 * also snaps to that same inspector's Step setting (`rotationStep`), so the
 * handle always lands on the same clean angles as the +/- nudge buttons.
 *
 * `composeMode`:
 *  - 'local': single-board rotate — the canonical axis is post-multiplied
 *    onto the proxy's quaternion, identical to incrementRotation's
 *    body-fixed local-axis math. The badge tracks the board's live
 *    orientation every frame, so it visually stays attached to the same
 *    face/edge as the board spins.
 *  - 'world': multi/group rotate — the canonical axis is pre-multiplied
 *    (a fixed world axis), identical to incrementAssemblyRotation. The AABB
 *    pivot-swing itself is handled by the existing onDrag callback
 *    (TransformGizmo's handleObjectChange); this component only has to
 *    keep the proxy's quaternion correct.
 *
 * A rotation around an axis never moves that axis, so the world-space
 * drag plane (frozen from the axis's direction at pointerdown) stays valid
 * for the whole gesture even as the board spins.
 */
export default function RotateAxisHandle({
  axisIndex, color, label, anchor, halfExtent, proxyRef, composeMode, rotationStep,
  onDragStart, onDrag, onDragEnd,
}) {
  const { camera, gl } = useThree();
  const groupRef = useRef(null);
  const iconWrapRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [angleDeg, setAngleDeg] = useState(0);
  const dragState = useRef(null);

  const canonAxis = CANON_AXES[axisIndex];
  const margin = Math.max(MARGIN_MIN, halfExtent * MARGIN_RATIO);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const worldDir = (composeMode === 'local' && proxyRef.current)
      ? canonAxis.clone().applyQuaternion(proxyRef.current.quaternion)
      : canonAxis;
    const d = halfExtent + margin;
    g.position.set(
      anchor[0] + worldDir.x * d,
      anchor[1] + worldDir.y * d,
      anchor[2] + worldDir.z * d,
    );

    // Foreshorten the icon the same way a real 3D ring lying in this axis's
    // rotation plane would look from the current camera angle: a flattened
    // "wave" when the ring is nearly edge-on (axis lying across the
    // screen), closer to the full round glyph when looking more down the
    // barrel of the axis. Exact closed-form ellipse-from-conjugate-radii
    // solution (eigen-decomposition of M·Mᵀ where M's columns are the
    // screen-projected images of two perpendicular unit vectors spanning
    // the ring's plane) — not an approximation.
    if (iconWrapRef.current) {
      const camRight = _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      const camUp = _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
      const helper = Math.abs(worldDir.y) < 0.9 ? _helperY : _helperX;
      const u = _ringU.crossVectors(helper, worldDir).normalize();
      const v = _ringV.crossVectors(worldDir, u).normalize();
      const pux = u.dot(camRight), puy = u.dot(camUp);
      const pvx = v.dot(camRight), pvy = v.dot(camUp);

      const A = pux * pux + pvx * pvx;
      const C = puy * puy + pvy * pvy;
      const B = pux * puy + pvx * pvy;
      const thetaDeg = THREE.MathUtils.radToDeg(0.5 * Math.atan2(2 * B, A - C));
      const mid = (A + C) / 2;
      const rad = Math.sqrt(Math.max(0, ((A - C) / 2) ** 2 + B * B));
      const lambdaMax = mid + rad;
      const lambdaMin = Math.max(0, mid - rad);
      const squash = lambdaMax > 1e-8
        ? Math.max(0.12, Math.sqrt(lambdaMin / lambdaMax))
        : 1;
      iconWrapRef.current.style.transform = `rotate(${thetaDeg.toFixed(1)}deg) scaleY(${squash.toFixed(3)})`;
    }
  });

  // Screen-space angle of the mouse around the selection's projected center
  // — the same robust technique the original free view-axis spin used.
  // A literal 3D raycast onto the plane perpendicular to the axis would be
  // more "physically exact" but goes numerically unstable (huge angle
  // jumps from tiny mouse moves) whenever that axis is roughly edge-on to
  // the camera — which is routine for 2 of the 3 axes at any given
  // viewing angle. This 2D approach has no such singularity.
  const angleAtClient = useCallback((clientX, clientY, center) => {
    return Math.atan2(clientY - center.y, clientX - center.x);
  }, []);

  // Swing-twist decomposition: the signed angle "baked into" a quaternion
  // around a specific axis, independent of whatever rotation it also has
  // around other axes. Reads exactly 0° at the identity (flat/"on the
  // floor") orientation, and — unlike reading the axis's Euler component
  // straight off the quaternion — stays perfectly additive even when the
  // other two axes are already non-zero (Euler components couple with
  // each other once more than one axis has been touched; this doesn't).
  // This is what makes the readout absolute/floor-relative rather than a
  // delta from wherever the drag happened to start.
  const twistAngleDeg = (q, axis) => {
    const dot = q.x * axis.x + q.y * axis.y + q.z * axis.z;
    return THREE.MathUtils.radToDeg(2 * Math.atan2(dot, q.w));
  };

  const handlePointerDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const v = new THREE.Vector3(anchor[0], anchor[1], anchor[2]).project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    const center = {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
    dragState.current = {
      center,
      lastAngle: angleAtClient(e.clientX, e.clientY, center),
      totalAngle: 0,
      appliedDeg: 0,
    };
    const proxy = proxyRef.current;
    setAngleDeg(proxy ? twistAngleDeg(proxy.quaternion, canonAxis) : 0);
    setDragging(true);
    onDragStart?.();
  }, [anchor, camera, gl, canonAxis, proxyRef, angleAtClient, onDragStart]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const ds = dragState.current;
      if (!ds || ds.lastAngle === null) return;
      const angle = angleAtClient(e.clientX, e.clientY, ds.center);
      let delta = angle - ds.lastAngle;
      // Normalize across the atan2 +/-pi seam so the drag can't jump.
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      ds.lastAngle = angle;
      ds.totalAngle += delta;

      // Snap to the same Step setting the Local Orientation +/- buttons use
      // (5°, 15°, etc.) — the quaternion only actually advances in those
      // increments, so the drag feels notchy/stepped rather than free, and
      // always lands on a clean angle like the keyboard/button nudges do.
      // (This bookkeeping is drag-relative on purpose — it's just deciding
      // how much *more* rotation to apply each tick. What gets displayed
      // is the absolute twist angle below, not this running total.)
      const totalDeg = THREE.MathUtils.radToDeg(ds.totalAngle);
      const step = rotationStep > 0 ? rotationStep : 0;
      const snappedDeg = step > 0 ? Math.round(totalDeg / step) * step : totalDeg;

      if (snappedDeg !== ds.appliedDeg) {
        const stepDeltaRad = THREE.MathUtils.degToRad(snappedDeg - ds.appliedDeg);
        const proxy = proxyRef.current;
        if (proxy) {
          const deltaQuat = new THREE.Quaternion().setFromAxisAngle(canonAxis, stepDeltaRad);
          if (composeMode === 'local') {
            proxy.quaternion.multiply(deltaQuat);
          } else {
            proxy.quaternion.premultiply(deltaQuat);
          }
          setAngleDeg(twistAngleDeg(proxy.quaternion, canonAxis));
        }
        ds.appliedDeg = snappedDeg;
        onDrag?.();
      }
    };
    const onUp = () => {
      setDragging(false);
      dragState.current = null;
      onDragEnd?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, angleAtClient, proxyRef, canonAxis, composeMode, rotationStep, onDrag, onDragEnd]);

  return (
    <group ref={groupRef}>
      <Html center>
        <div style={{ position: 'relative' }}>
          <div
            onPointerDown={handlePointerDown}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            title={label}
            style={{
              width: `${BADGE_SIZE}px`,
              height: dragging ? `${PILL_HEIGHT}px` : `${BADGE_SIZE}px`,
              borderRadius: `${BADGE_SIZE / 2}px`,
              background: dragging ? color : '#ffffff',
              color: dragging ? '#ffffff' : color,
              display: 'flex',
              alignItems: dragging ? 'flex-start' : 'center',
              justifyContent: 'center',
              paddingTop: dragging ? '7px' : 0,
              fontSize: '15px',
              lineHeight: 1,
              boxShadow: hovered || dragging
                ? `0 0 0 2px ${color}, 0 2px 10px rgba(0,0,0,0.45)`
                : '0 2px 6px rgba(0,0,0,0.3)',
              border: `1px solid ${color}`,
              cursor: dragging ? 'grabbing' : 'grab',
              userSelect: 'none',
              transition: 'height 100ms ease-out, box-shadow 80ms, background 80ms, color 80ms',
            }}
          >
            <span
              ref={iconWrapRef}
              style={{ display: 'inline-flex', transformOrigin: 'center', willChange: 'transform' }}
            >
              <RotateIcon size={dragging ? 17 : 16} color="currentColor" />
            </span>
          </div>
          {/* Trailing "pin" tail while dragging, echoing Make.by.me's stretched handle look */}
          {dragging && (
            <div style={{
              position: 'absolute',
              left: '50%',
              top: '100%',
              transform: 'translateX(-50%)',
              width: '2px',
              height: `${TAIL_LENGTH}px`,
              background: color,
              pointerEvents: 'none',
            }} />
          )}
          {dragging && (() => {
            // The underlying rotation only ever advances in exact
            // `rotationStep` increments (see onMove above) — but the
            // absolute twist angle itself can land on a non-round number
            // if another axis was already rotated (e.g. -54.7° instead of
            // -55°), since twist-about-this-axis picks up a fixed coupling
            // offset from whatever the other axes contributed. Round only
            // the *display* to the nearest step so what you see always
            // reads as a clean multiple of your Step setting; the actual
            // applied rotation (and the "standard angle" check below) still
            // use the exact value.
            const step = rotationStep > 0 ? rotationStep : 1;
            const displayDeg = Math.round(angleDeg / step) * step;
            const nearestStandard = Math.round(angleDeg / STANDARD_ANGLE_STEP) * STANDARD_ANGLE_STEP;
            const atStandardAngle = Math.abs(angleDeg - nearestStandard) <= STANDARD_ANGLE_TOLERANCE;
            const accent = atStandardAngle ? '#22c55e' : color;
            return (
              <div style={{
                position: 'absolute',
                left: `calc(100% + 10px)`,
                top: '8px',
                background: '#ffffff',
                color: '#1a1a1a',
                fontWeight: 700,
                fontSize: '14px',
                padding: '4px 10px',
                borderRadius: '8px',
                border: `2px solid ${accent}`,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}>
                {displayDeg >= 0 ? '+' : ''}{displayDeg}°
              </div>
            );
          })()}
        </div>
      </Html>
    </group>
  );
}

