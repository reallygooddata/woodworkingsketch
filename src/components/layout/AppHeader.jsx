import React, { useState, useEffect, useRef } from 'react';

import useStore from '../../store/useStore';

const AppHeader = () => {
    const {
        fileMenuOpen, setFileMenuOpen,
        saveWorkspace, exportWorkspace, exportGLB, loadWorkspace, importWorkspace,
        setShowNewWorkspaceDialog,
        setShowSavePromptDialog,
        setShowPrintDialog,
        setCabinetDialog, setShakerDoorDialog,
        recentFiles,
        handleUndo, handleRedo, history, redoHistory,
        setShowKeyboardShortcutsDialog,
        showCutlistPanel, setShowCutlistPanel,
        showSettingsPanel, setShowSettingsPanel,
        showAssemblyLibrary, setShowAssemblyLibrary,
        showLightingPanel, setShowLightingPanel,
        showMaterialsPanel, setShowMaterialsPanel,
        showAddComponentPanel, setShowAddComponentPanel,
        showAssembliesPanel, setShowAssembliesPanel,
        showToolsPanel, setShowToolsPanel,
        showHardwarePanel, setShowHardwarePanel,
        showAnimationPanel, setShowAnimationPanel,
        showOutlinerPanel, setShowOutlinerPanel,
        isOrtho, setIsOrtho,
        showGrid, setShowGrid,
        showMeasurements, setShowMeasurements,
        measureMode, setMeasureMode,
        showMeasurePanel, setShowMeasurePanel,
        isRightPanelOpen, setIsRightPanelOpen,
        currentFileName,
        setHeaderBottom,
        panelLayoutMode,
        showRecorderPanel, setShowRecorderPanel, isRecording,
        units, setUnits
    } = useStore();

    const isAdvanced = panelLayoutMode !== 'standard';

    const [isNavOpen, setIsNavOpen] = useState(true);
    const headerRef = useRef(null);
    const fileMenuRef = useRef(null);

    useEffect(() => {
        if (!headerRef.current) return;
        const ro = new ResizeObserver(() => {
            if (headerRef.current) {
                const rect = headerRef.current.getBoundingClientRect();
                setHeaderBottom(rect.bottom + 16); // 16px buffer
            }
        });
        ro.observe(headerRef.current);
        return () => ro.disconnect();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (fileMenuOpen && fileMenuRef.current && !fileMenuRef.current.contains(event.target)) {
                setFileMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [fileMenuOpen, setFileMenuOpen]);

    return (
        <div className="header-overlay" ref={headerRef}>
            
            {/* ── CARD 1: Logo & File Menu (Fixed Left) ── */}
            <header className="header-left-card glass-panel">
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="logo">Little Lucey <span>Woodcraft</span></div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--accent-color)', marginTop: '12px', paddingLeft: '2px', opacity: 0.7 }}>{currentFileName || 'Untitled'}</div>
                </div>
                <div className="toolbar-menus">
                    <div ref={fileMenuRef} style={{ position: 'relative', display: 'inline-block' }}>
                        <span onClick={() => setFileMenuOpen(!fileMenuOpen)} style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', background: fileMenuOpen ? 'var(--bg-color)' : 'transparent' }}>
                            File ⏷
                        </span>
                        {fileMenuOpen && (
                            <div className="glass-panel" style={{
                                position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                                display: 'flex', flexDirection: 'column', padding: '8px', minWidth: '160px',
                                zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
                                borderRadius: '8px', background: 'var(--menu-bg)'
                            }}>
                                <button className="nav-btn" style={{ textAlign: 'left', border: 'none', padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => { setFileMenuOpen(false); setShowNewWorkspaceDialog(true); }}>✨ New Project</button>
                                <div className="divider" style={{ width: '100%', height: '1px', margin: '4px 0' }}></div>
                                <div style={{ padding: '4px 12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Local</div>
                                <button className="nav-btn" style={{ textAlign: 'left', border: 'none', padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => { saveWorkspace(); setFileMenuOpen(false); }}>💾 Save</button>
                                <button className="nav-btn" style={{ textAlign: 'left', border: 'none', padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => { setShowSavePromptDialog(true); setFileMenuOpen(false); }}>💾 New...</button>

                                {recentFiles.length > 0 && (
                                    <>
                                        <div style={{ padding: '4px 12px', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Open</div>
                                        {recentFiles.map(r => (
                                            <button key={r.name} className="nav-btn" style={{ textAlign: 'left', border: 'none', padding: '6px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => { loadWorkspace(r.name); setFileMenuOpen(false); }}>
                                                ⏱ {r.name}
                                            </button>
                                        ))}
                                    </>
                                )}

                                <div className="divider" style={{ width: '100%', height: '1px', margin: '4px 0' }}></div>
                                <div style={{ padding: '4px 12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Disk</div>
                                <button className="nav-btn" style={{ textAlign: 'left', border: 'none', padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => { exportWorkspace(); setFileMenuOpen(false); }}>🖨️ Save...</button>
                                <button className="nav-btn" style={{ textAlign: 'left', border: 'none', padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => { document.getElementById('project-import-input').click(); setFileMenuOpen(false); }}>📂 Open...</button>
                                <button className="nav-btn" style={{ textAlign: 'left', border: 'none', padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => { exportGLB(); setFileMenuOpen(false); }}>📤 Export 3D Model (.glb)</button>
                                <div className="divider" style={{ width: '100%', height: '1px', margin: '4px 0' }}></div>
                                <button className="nav-btn" style={{ textAlign: 'left', border: 'none', padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => { setShowPrintDialog(true); setFileMenuOpen(false); }}>🖨️ Print View...</button>
                            </div>
                        )}
                    </div>

                    <input type="file" id="project-import-input" accept=".json" style={{ display: 'none' }} onChange={importWorkspace} />
                    <span onClick={handleUndo} style={{ opacity: history.length ? 1 : 0.4, marginLeft: '8px', cursor: history.length ? 'pointer' : 'default' }}>↺ Undo ({history.length})</span>
                    <span onClick={handleRedo} style={{ opacity: redoHistory.length ? 1 : 0.4, marginLeft: '8px', cursor: redoHistory.length ? 'pointer' : 'default' }}>↻ Redo ({redoHistory.length})</span>
                    <span onClick={() => setShowKeyboardShortcutsDialog(true)} title="Keyboard Shortcuts" style={{ marginLeft: '8px', cursor: 'pointer', opacity: 0.75 }}>⌨️ Shortcuts</span>
                </div>
            </header>

            {/* ── CARD 2: Sliding Nav Drawer (Right) ── */}
            <div className="header-right-wrapper">

                {/* Sliding Grid */}
                <div className={`nav-drawer glass-panel ${isNavOpen ? 'open' : 'collapsed'}`}>
                    <nav className="top-nav">
                        
                        {/* Row 1 */}
                        <button className={`nav-btn ${showAddComponentPanel ? 'active' : ''}`} onClick={() => setShowAddComponentPanel(!showAddComponentPanel)} title="Add shapes" style={{ gridColumn: 1, gridRow: 1 }}>🔷 Components</button>
                        <button className={`nav-btn ${isOrtho ? 'active' : ''}`} onClick={() => setIsOrtho(!isOrtho)} title="Camera Mode" style={{ gridColumn: 2, gridRow: 1 }}>
                            {isOrtho ? '📐 Parallel' : '📷 Perspective'}
                        </button>
                        <button className={`nav-btn ${showMeasurePanel ? 'active' : ''}`} onClick={() => {
                            setShowMeasurePanel(!showMeasurePanel);
                        }} title="Measure distances" style={{ gridColumn: 3, gridRow: 1 }}>📏 Measure</button>
                        <button className={`nav-btn ${showOutlinerPanel ? 'active' : ''}`} onClick={() => setShowOutlinerPanel(!showOutlinerPanel)} title="Toggle Outliner" style={{ gridColumn: 4, gridRow: 1 }}>🗂️ Outliner</button>

                        {/* Row 2 */}
                        <button className={`nav-btn ${showAssembliesPanel ? 'active' : ''}`} onClick={() => setShowAssembliesPanel(!showAssembliesPanel)} title="Parametric builders" style={{ gridColumn: 1, gridRow: 2 }}>🧱 Builders</button>
                        <button className={`nav-btn ${showToolsPanel ? 'active' : ''}`} onClick={() => setShowToolsPanel(!showToolsPanel)} title="CSG modifiers" style={{ gridColumn: 2, gridRow: 2 }}>🧰 Tools</button>
                        <button className={`nav-btn ${showCutlistPanel ? 'active' : ''}`} onClick={() => setShowCutlistPanel(!showCutlistPanel)} style={{ gridColumn: 3, gridRow: 2 }}>📋 Cut List</button>
                        <button className={`nav-btn ${showSettingsPanel ? 'active' : ''}`} onClick={() => setShowSettingsPanel(!showSettingsPanel)} style={{ gridColumn: 4, gridRow: 2 }}>⚙️ Settings</button>

                        {/* Row 3 (Advanced Only) */}
                        {isAdvanced && (
                            <>
                                <button className={`nav-btn ${showAssemblyLibrary ? 'active' : ''}`} onClick={() => setShowAssemblyLibrary(!showAssemblyLibrary)} style={{ gridColumn: 1, gridRow: 3 }}>📦 Library</button>
                                <button className={`nav-btn ${showMaterialsPanel ? 'active' : ''}`} onClick={() => setShowMaterialsPanel(!showMaterialsPanel)} style={{ gridColumn: 2, gridRow: 3 }}>🎨 Materials</button>
                                <button className={`nav-btn ${showLightingPanel ? 'active' : ''}`} onClick={() => setShowLightingPanel(!showLightingPanel)} style={{ gridColumn: 3, gridRow: 3 }}>💡 Lighting</button>
                                <button className={`nav-btn ${showAnimationPanel ? 'active' : ''}`} onClick={() => setShowAnimationPanel(!showAnimationPanel)} title="Animate" style={{ gridColumn: 4, gridRow: 3 }}>🎬 Animate</button>
                            </>
                        )}

                        {/* Col 5 (Fixed) */}
                        <label className="nav-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.71rem', userSelect: 'none', margin: 0, padding: '3px 8px', gridColumn: 5, gridRow: 1 }}>
                            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} style={{ accentColor: 'var(--accent-color)', width: '12px', height: '12px', cursor: 'pointer' }} />
                            Grid
                        </label>
                        <label className="nav-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.71rem', userSelect: 'none', margin: 0, padding: '3px 8px', gridColumn: 5, gridRow: 2 }}>
                            <input type="checkbox" checked={showMeasurements} onChange={e => setShowMeasurements(e.target.checked)} style={{ accentColor: 'var(--accent-color)', width: '12px', height: '12px', cursor: 'pointer' }} />
                            Dims
                        </label>
                        <button
                            className="nav-btn"
                            onClick={() => setUnits(units === 'imperial' ? 'metric' : 'imperial')}
                            title="Toggle measurement system (Inches / Metric)"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                cursor: 'pointer',
                                fontSize: '0.71rem',
                                userSelect: 'none',
                                margin: 0,
                                padding: '3px 8px',
                                gridColumn: 5,
                                gridRow: 3,
                                border: 'none',
                                background: 'rgba(188, 138, 95, 0.1)',
                                color: 'var(--accent-color)',
                                borderRadius: '5px',
                                height: '100%',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            📏 {units === 'imperial' ? 'Inches' : 'Metric'}
                        </button>
                        {/* <button 
                            className={`nav-btn ${showRecorderPanel ? 'active' : ''}`} 
                            onClick={() => setShowRecorderPanel(!showRecorderPanel)}
                            title="Step-by-Step Tutorial Recorder"
                            style={{ 
                                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                gap: '4px', cursor: 'pointer', fontSize: '0.71rem', userSelect: 'none', 
                                margin: 0, padding: '3px 8px', gridColumn: 5, gridRow: 3, border: 'none', background: 'transparent'
                            }}
                        >
                            {isRecording ? (
                                <span className="rec-dot-pulse" style={{
                                    width: '8px', height: '8px', background: '#ff3b30', borderRadius: '50%',
                                    display: 'inline-block', boxShadow: '0 0 6px #ff3b30'
                                }} />
                            ) : '🔴'}
                            Record
                        </button> */}

                    </nav>
                </div>

                {/* Arrow Toggle */}
                <div 
                    className="nav-toggle-btn" 
                    onClick={() => setIsNavOpen(!isNavOpen)}
                    title={isNavOpen ? 'Hide Toolbars' : 'Show Toolbars'}
                >
                    {isNavOpen ? '▶' : '◀'}
                </div>
            </div>
        </div>
    );
};

export default AppHeader;
