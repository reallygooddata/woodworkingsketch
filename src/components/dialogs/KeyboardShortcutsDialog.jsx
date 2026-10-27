import React from 'react';
import useStore from '../../store/useStore';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUT_GROUPS = [
    {
        title: 'Editing',
        shortcuts: [
            { keys: [MOD, 'Z'], label: 'Undo' },
            { keys: [MOD, 'Shift', 'Z'], label: 'Redo' },
            { keys: [MOD, 'D'], label: 'Duplicate selected' },
            { keys: ['Delete'], label: 'Delete selected' },
            { keys: [MOD, 'A'], label: 'Select all boards' },
            { keys: [MOD, 'S'], label: 'Save project' },
        ],
    },
    {
        title: 'Selection & Viewport',
        shortcuts: [
            { keys: ['Esc'], label: 'Deselect / cancel current tool' },
            { keys: ['\u2190\u2191\u2192\u2193'], label: 'Nudge selected board(s)' },
            { keys: ['Shift', '\u2190\u2191\u2192\u2193'], label: 'Nudge in larger steps (10\u00d7)' },
            { keys: ['G'], label: 'Switch gizmo to Move' },
            { keys: ['R'], label: 'Switch gizmo to Rotate' },
            { keys: ['Hold D'], label: 'Smart-snap drag selected board' },
        ],
    },
];

const Key = ({ children }) => (
    <kbd style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: '22px', padding: '2px 7px', fontSize: '0.78rem', fontFamily: 'inherit',
        background: 'var(--bg-color, #1e1e1e)', color: 'var(--text-main)',
        border: '1px solid var(--border-color, rgba(255,255,255,0.2))',
        borderBottom: '2px solid var(--border-color, rgba(255,255,255,0.25))',
        borderRadius: '5px',
    }}>
        {children}
    </kbd>
);

const KeyboardShortcutsDialog = () => {
    const { showKeyboardShortcutsDialog, setShowKeyboardShortcutsDialog } = useStore();

    if (!showKeyboardShortcutsDialog) return null;

    const close = () => setShowKeyboardShortcutsDialog(false);

    return (
        <div
            className="app-overlay"
            style={{ background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'fixed', inset: 0 }}
            onClick={close}
        >
            <div
                className="glass-panel"
                style={{ padding: '24px', width: '420px', maxHeight: '80vh', overflowY: 'auto', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, color: 'var(--text-main)' }}>⌨️ Keyboard Shortcuts</h3>
                    <span onClick={close} style={{ cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-muted)', lineHeight: 1 }}>✕</span>
                </div>

                {SHORTCUT_GROUPS.map((group) => (
                    <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent-color, #ff7a00)' }}>
                            {group.title}
                        </div>
                        {group.shortcuts.map((s) => (
                            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{s.label}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                    {s.keys.map((k, i) => (
                                        <React.Fragment key={i}>
                                            {i > 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>+</span>}
                                            <Key>{k}</Key>
                                        </React.Fragment>
                                    ))}
                                </span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default KeyboardShortcutsDialog;
