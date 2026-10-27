import React from 'react';
import useStore from '../../store/useStore';

/**
 * Compact Move/Rotate/Off toggle for the on-screen mouse transform gizmo.
 * Shared across the single-board, multi-select, and assembly inspectors so
 * the control looks and behaves identically regardless of what's selected.
 */
const GizmoModeToggle = () => {
    const gizmoEnabled = useStore(s => s.gizmoEnabled);
    const gizmoMode = useStore(s => s.gizmoMode);
    const setGizmoEnabled = useStore(s => s.setGizmoEnabled);
    const setGizmoMode = useStore(s => s.setGizmoMode);

    const select = (mode) => {
        if (mode === 'off') {
            setGizmoEnabled(false);
        } else {
            setGizmoMode(mode);
            setGizmoEnabled(true);
        }
    };

    const isActive = (mode) => mode === 'off' ? !gizmoEnabled : (gizmoEnabled && gizmoMode === mode);

    return (
        <div className="inspector-card">
            <h4>Transform</h4>
            <div style={{ display: 'flex', gap: '6px' }}>
                <button
                    className={`nav-btn${isActive('translate') ? ' active' : ''}`}
                    style={{ flex: 1, padding: '6px 0' }}
                    title="Drag to move (hotkey: G)"
                    onClick={() => select('translate')}
                >
                    ✥ Move
                </button>
                <button
                    className={`nav-btn${isActive('rotate') ? ' active' : ''}`}
                    style={{ flex: 1, padding: '6px 0' }}
                    title="Drag to pivot/rotate (hotkey: R)"
                    onClick={() => select('rotate')}
                >
                    ⟳ Rotate
                </button>
                <button
                    className={`nav-btn${isActive('off') ? ' active' : ''}`}
                    style={{ flex: '0 0 auto', padding: '6px 10px' }}
                    title="Hide the on-screen gizmo"
                    onClick={() => select('off')}
                >
                    Off
                </button>
            </div>
            <div className="hint" style={{ marginTop: '6px', fontSize: '0.75rem' }}>
                Drag the gizmo in the viewport, or press G / R to switch modes.
            </div>
        </div>
    );
};

export default GizmoModeToggle;
