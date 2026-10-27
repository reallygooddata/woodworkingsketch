import React, { useState } from 'react';

import useStore from '../../store/useStore';
import versionInfo from '../../version.json';

const SettingsPanel = () => {
    const {
        units, setUnits,
        gridSnap, setGridSnap,
        defaultMaterial, setDefaultMaterial,
        showEdges, setShowEdges,
        showMeasurements, setShowMeasurements,
        showBoundingBox, setShowBoundingBox,
        enableCollisions, setEnableCollisions,
        globalBounds, setGlobalBounds,
        theme, setTheme,
        autosaveInterval, setAutosaveInterval,
        showToast,
        panelLayoutMode, setPanelLayoutMode,
        workspaceLayout, setWorkspaceLayout,
        lumberyardSnapEnabled, setLumberyardSnapEnabled,
        measurementStyle, setMeasurementStyle,
        gizmoMagneticSnap, setGizmoMagneticSnap,
        setShowAttributionDialog,
        setShowUserManualDialog
    } = useStore();
    const [confirmWipe, setConfirmWipe] = useState(false);

    const labelStyle = {
        fontSize: '0.64rem',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: 'var(--accent-color, #ff7a00)', // Changed to orange; change back to var(--text-muted, #888) if desired
        display: 'block',
        marginBottom: '2px',
    };

    const selectStyle = {
        width: '100%',
        padding: '3px 6px',
        background: 'var(--bg-color, #1a1a1a)',
        color: 'var(--text-main, #ffffff)',
        border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
        borderRadius: '6px',
        outline: 'none',
        fontSize: '0.72rem',
        cursor: 'pointer',
    };

    const optionStyle = {
        background: 'var(--menu-bg, #0d0f12)',
        color: 'var(--text-main, #f0f0f0)',
    };

    const checkboxLabelStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        cursor: 'pointer',
        fontWeight: '600',
        fontSize: '0.72rem',
        color: 'var(--text-main)',
    };

    const checkboxInputStyle = {
        width: '12px',
        height: '12px',
        cursor: 'pointer',
        accentColor: 'var(--accent-color)',
    };

    const hintStyle = {
        fontSize: '0.62rem',
        marginTop: '2px',
        lineHeight: '1.2',
    };

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '6px',
            padding: '2px',
            color: 'var(--text-main)'
        }}>

            <div className="inspector-card">
                <label style={labelStyle}>Measurement System</label>
                <select value={units} onChange={(e) => setUnits(e.target.value)} style={selectStyle}>
                    <option value="imperial" style={optionStyle}>Imperial (Inches / Fractions)</option>
                    <option value="metric" style={optionStyle}>Metric (Millimeters)</option>
                </select>
                <p className="hint" style={hintStyle}>Viewport vectors automatically convert to your selected system.</p>
            </div>

            <div className="inspector-card">
                <label style={labelStyle}>Global Grid Snapping</label>
                <select value={gridSnap} onChange={(e) => setGridSnap(e.target.value)} style={selectStyle}>
                    {units === 'metric' ? (
                        <>
                            <option value="off" style={optionStyle}>Off (Free floating)</option>
                            <option value="1 mm" style={optionStyle}>1 mm (Extreme)</option>
                            <option value="2 mm" style={optionStyle}>2 mm (Fine)</option>
                            <option value="5 mm" style={optionStyle}>5 mm (Standard)</option>
                            <option value="10 mm" style={optionStyle}>10 mm (Rough)</option>
                        </>
                    ) : (
                        <>
                            <option value="off" style={optionStyle}>Off (Free floating)</option>
                            <option value="1/16 in" style={optionStyle}>1/16 Inch (Extreme)</option>
                            <option value="1/8 in" style={optionStyle}>1/8 Inch (Fine)</option>
                            <option value="1/4 in" style={optionStyle}>1/4 Inch (Standard)</option>
                            <option value="1/2 in" style={optionStyle}>1/2 Inch (Rough)</option>
                            <option value="1 in" style={optionStyle}>1 Inch (Very Rough)</option>
                        </>
                    )}
                </select>
                <p className="hint" style={hintStyle}>Controls the bounding lock when nudging components.</p>
            </div>

            <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={checkboxLabelStyle}>
                    <input type="checkbox" checked={gizmoMagneticSnap} onChange={(e) => setGizmoMagneticSnap(e.target.checked)} style={checkboxInputStyle} />
                    Magnetic Alignment Snap
                </label>
                <p className="hint" style={hintStyle}>While dragging the Transform gizmo, catches and holds onto nearby aligned faces (same highlight shown while dragging). Turn off for unassisted free movement.</p>
            </div>

            <div className="inspector-card">
                <label style={labelStyle}>Workspace Scale (Grid Size)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input type="number" step="1" min="1" max="100" style={{
                        flex: 1, padding: '3px 6px',
                        background: 'var(--bg-color, #1e1e1e)', color: 'var(--text-main, #ffffff)',
                        border: '1px solid var(--border-color, rgba(255,255,255,0.15))', borderRadius: '6px',
                        outline: 'none', fontSize: '0.72rem'
                    }} value={(useStore(s => s.workspaceSize) || 120) / 12} onChange={(e) => useStore.getState().setWorkspaceSize((parseFloat(e.target.value) || 10) * 12)} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>feet</span>
                </div>
                <p className="hint" style={hintStyle}>Defines total width/length of the 3D grid plane.</p>
            </div>

            <div className="inspector-card">
                <label style={labelStyle}>Default Board Lumber</label>
                <select value={defaultMaterial} onChange={(e) => setDefaultMaterial(e.target.value)} style={{ ...selectStyle, textTransform: 'capitalize' }}>
                    {['pine', 'cherry', 'walnut', 'red-oak', 'white-oak'].map(m => <option key={m} value={m} style={optionStyle}>{m.replace('-', ' ')}</option>)}
                </select>
                <p className="hint" style={hintStyle}>Default wood allocated when generating new boards.</p>
            </div>

            <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={checkboxLabelStyle}>
                    <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} style={checkboxInputStyle} />
                    Architectural Edges
                </label>
                <p className="hint" style={hintStyle}>Renders high-contrast boundary lines.</p>
            </div>

             <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={checkboxLabelStyle}>
                    <input type="checkbox" checked={showMeasurements} onChange={(e) => setShowMeasurements(e.target.checked)} style={checkboxInputStyle} />
                    Show Dimensions
                </label>
                <p className="hint" style={hintStyle}>Renders 3D dimension lines in the viewport.</p>
            </div>

            <div className="inspector-card">
                <label style={labelStyle}>Dimension End Style</label>
                <select value={measurementStyle || 'arrows'} onChange={(e) => setMeasurementStyle(e.target.value)} style={selectStyle}>
                    <option value="arrows" style={optionStyle}>Solid Arrowheads (Modern Drafting)</option>
                    <option value="slashes" style={optionStyle}>Architectural Slashes (45° Ticks)</option>
                    <option value="spheres" style={optionStyle}>Standard Balls (Classic spheres)</option>
                </select>
                <p className="hint" style={hintStyle}>End treatment for measurement lines.</p>
            </div>

            <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={checkboxLabelStyle}>
                    <input type="checkbox" checked={showBoundingBox} onChange={(e) => setShowBoundingBox(e.target.checked)} style={checkboxInputStyle} />
                    Selection Envelope
                </label>
                <p className="hint" style={hintStyle}>Renders an absolute 3D boundary envelope.</p>
            </div>

            <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={checkboxLabelStyle}>
                    <input type="checkbox" checked={enableCollisions} onChange={(e) => setEnableCollisions(e.target.checked)} style={checkboxInputStyle} />
                    Collision Warnings
                </label>
                <p className="hint" style={hintStyle}>Visually flag overlapping geometry intersections.</p>
            </div>

            {/* <div className="inspector-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Project Volume Bounds</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 'normal', fontSize: '0.72rem', color: 'var(--accent-color)' }}>
                        <input type="checkbox" checked={globalBounds.enabled} onChange={(e) => setGlobalBounds(prev => ({ ...prev, enabled: e.target.checked }))} style={checkboxInputStyle} />
                    </label>
                </div>
                <p className="hint" style={hintStyle}>Forces Top generation AI to strictly shrink boards to tolerances.</p>
                {globalBounds.enabled && (
                    <div className="vec3-inputs" style={{ marginTop: '4px' }}>
                        <div>W<input type="number" step="1" value={globalBounds.x} onChange={e => setGlobalBounds(prev => ({ ...prev, x: parseFloat(e.target.value) || 0 }))} title="Max Width" style={{ padding: '2px 4px', fontSize: '0.7rem' }} /></div>
                        <div style={{ borderColor: 'var(--accent-color)' }}>H<input type="number" step="1" value={globalBounds.y} onChange={e => setGlobalBounds(prev => ({ ...prev, y: parseFloat(e.target.value) || 0 }))} title="Max Height" style={{ padding: '2px 4px', fontSize: '0.7rem' }} /></div>
                        <div>D<input type="number" step="1" value={globalBounds.z} onChange={e => setGlobalBounds(prev => ({ ...prev, z: parseFloat(e.target.value) || 0 }))} title="Max Depth" style={{ padding: '2px 4px', fontSize: '0.7rem' }} /></div>
                    </div>
                )}
            </div> */}

            <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label style={checkboxLabelStyle}>
                    <input type="checkbox" checked={theme === 'dark'} onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')} style={checkboxInputStyle} />
                    Dark Mode Enabled
                </label>
                <p className="hint" style={hintStyle}>Toggle between dark theme and daylight drafting mode.</p>
            </div>

            <div className="inspector-card">
                <label style={labelStyle}>Interface Mode</label>
                <select value={panelLayoutMode || 'advanced'} onChange={(e) => setPanelLayoutMode(e.target.value)} style={selectStyle}>
                    <option value="standard" style={optionStyle}>Standard (Simplified Woodworking)</option>
                    <option value="advanced" style={optionStyle}>Advanced (All Features)</option>
                </select>
                <p className="hint" style={hintStyle}>Hides lighting, materials, library, animation in standard.</p>
            </div>

            <div className="inspector-card">
                <label style={labelStyle}>Autosave Schedule</label>
                <select value={autosaveInterval} onChange={(e) => setAutosaveInterval(e.target.value)} style={selectStyle}>
                    <option value="off" style={optionStyle}>Off</option>
                    <option value="1" style={optionStyle}>Every 1 minute</option>
                    <option value="5" style={optionStyle}>Every 5 minutes</option>
                    <option value="10" style={optionStyle}>Every 10 minutes</option>
                    <option value="30" style={optionStyle}>Every 30 minutes</option>
                </select>
                <p className="hint" style={hintStyle}>Silently saves workspace locally on schedule.</p>
            </div>

            <div className="inspector-card">
                <label style={labelStyle}>Workspace Layout</label>
                <select value={workspaceLayout || 'floating'} onChange={(e) => setWorkspaceLayout(e.target.value)} style={selectStyle}>
                    <option value="docked" style={optionStyle}>Docked Sidebar</option>
                    <option value="floating" style={optionStyle}>Classic Floating Panels</option>
                </select>
                <p className="hint" style={hintStyle}>Lock all panel sheets on the right side or let them float.</p>
            </div>



            <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={labelStyle}>User Manual & Shop Guide</label>
                <p className="hint" style={hintStyle}>Open the official step-by-step woodworking manual, guide to workbench coordinates, and tools reference guide.</p>
                <button
                    className="nav-btn"
                    style={{
                        width: 'fit-content',
                        padding: '6px 14px',
                        fontSize: '0.72rem',
                        fontWeight: 'bold',
                        marginTop: '4px',
                        borderColor: 'var(--accent-color)',
                        color: 'var(--accent-color)',
                        background: 'rgba(255, 122, 0, 0.05)',
                        transition: 'all 0.2s',
                        cursor: 'pointer'
                    }}
                    onMouseEnter={e => e.target.style.background = 'rgba(255, 122, 0, 0.15)'}
                    onMouseLeave={e => e.target.style.background = 'rgba(255, 122, 0, 0.05)'}
                    onClick={() => setShowUserManualDialog(true)}
                >
                    📖 Open User's Guide
                </button>
            </div>

            <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={labelStyle}>Software Version</label>
                <p className="hint" style={hintStyle}>Running version <strong>v{versionInfo.version}</strong> (Released {versionInfo.releasedAt}).</p>
                <a
                    href="https://github.com/vinyasa/sketch"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nav-btn"
                    style={{
                        width: 'fit-content',
                        padding: '6px 14px',
                        fontSize: '0.72rem',
                        fontWeight: 'bold',
                        marginTop: '4px',
                        borderColor: 'var(--accent-color)',
                        color: 'var(--accent-color)',
                        background: 'rgba(255, 122, 0, 0.05)',
                        transition: 'all 0.2s',
                        cursor: 'pointer',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                    }}
                    onMouseEnter={e => e.target.style.background = 'rgba(255, 122, 0, 0.15)'}
                    onMouseLeave={e => e.target.style.background = 'rgba(255, 122, 0, 0.05)'}
                >
                    🚀 View GitHub Releases
                </a>
            </div>

            <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={labelStyle}>Credits & Licenses</label>
                <p className="hint" style={hintStyle}>View attributions and licenses for the open-source libraries used in this project.</p>
                <button
                    className="nav-btn"
                    style={{
                        width: 'fit-content',
                        padding: '6px 14px',
                        fontSize: '0.72rem',
                        fontWeight: 'bold',
                        marginTop: '4px',
                        borderColor: 'var(--accent-color)',
                        color: 'var(--accent-color)',
                        background: 'rgba(255, 122, 0, 0.05)',
                        transition: 'all 0.2s',
                        cursor: 'pointer'
                    }}
                    onMouseEnter={e => e.target.style.background = 'rgba(255, 122, 0, 0.15)'}
                    onMouseLeave={e => e.target.style.background = 'rgba(255, 122, 0, 0.05)'}
                    onClick={() => setShowAttributionDialog(true)}
                >
                    📜 View Open Source Licenses
                </button>
            </div>

            <div className="inspector-card" style={{ borderColor: 'rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.05)' }}>
                <strong style={{ color: '#ff3b30', fontSize: '0.72rem' }}>System Storage Cache</strong>
                <p className="hint" style={{ ...hintStyle, marginBottom: '4px' }}>Permanently destroy the browser's local memory reserve.</p>
                {!confirmWipe ? (
                    <button className="nav-btn" style={{ color: '#ff3b30', borderColor: 'rgba(255, 59, 48, 0.3)', padding: '3px 10px', fontSize: '0.72rem' }} onClick={() => setConfirmWipe(true)}>Wipe Local Cache</button>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px', background: 'rgba(255,59,48,0.08)', borderRadius: '8px', border: '1px solid rgba(255,59,48,0.3)' }}>
                        <p style={{ margin: 0, fontSize: '0.7rem', color: '#ff3b30', fontWeight: '600' }}>⚠️ Are you sure? This cannot be undone.</p>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="primary-btn" style={{ flex: 1, background: '#ff3b30', borderColor: '#ff3b30', padding: '3px', fontSize: '0.7rem' }} onClick={() => {
                                localStorage.removeItem('lucey_save');
                                localStorage.removeItem('lucey_welcome_seen');
                                showToast('✅ Cache wiped! Reloading...');
                                setTimeout(() => window.location.reload(), 1500);
                            }}>Yes, wipe it</button>
                            <button className="nav-btn" style={{ flex: 1, padding: '3px', fontSize: '0.7rem' }} onClick={() => setConfirmWipe(false)}>Cancel</button>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
};

export default SettingsPanel;
