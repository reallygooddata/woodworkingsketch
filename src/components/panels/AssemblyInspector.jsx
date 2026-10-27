import React, { useState } from 'react';
import { computeWorldAABB, collectChildBoards } from '../../utils/sceneGraph';
import useStore from '../../store/useStore';
import ParametricControls from './ParametricControls';
import NumericInput from '../NumericInput';
import GizmoModeToggle from './GizmoModeToggle';

// Round to ≤4 decimal places, stripping trailing zeros
const fmt4 = (v) => parseFloat(v.toFixed(4));



const AssemblyInspector = ({ selectedGroup }) => {
    const {
        boards, groups, selectedItemIds, constraints, units,
        moveGroup, setSelectedItemIds, setGroups, setBoards,
        dropGroupToFloor, glueAssembly, unglueAssembly, createPivotProxy,
        handleAssemblyDelete, cloneAssembly, updateProceduralBox,
        constraintTargetMode, setConstraintTargetMode, incrementAssemblyRotation
    } = useStore();

    const [cloneMode, setCloneMode] = useState('worldX');
    const [cloneOffset, setCloneOffset] = useState(12);
    const [rotationStep, setRotationStep] = useState(5.0);

    const isWorkspace = selectedGroup === 'Workspace';
    const meta = !isWorkspace && groups[selectedGroup] ? groups[selectedGroup].meta : null;
    const hasBuilder = !!meta?.builder;

    const supportsX = hasBuilder;
    const supportsY = hasBuilder && meta.builder !== 'table-top';
    const supportsZ = hasBuilder && !['shaker-door', 'face-frame'].includes(meta.builder);

    // Compute overall dimensions and center from child boards
    const childBoards = collectChildBoards(selectedGroup, boards, groups);
    let overallSize = [0, 0, 0];
    let aabbCenter = [0, 0, 0];
    let isGlued = false;
    
    if (childBoards.length > 0) {
        const aabb = computeWorldAABB(childBoards);
        overallSize = [
            Math.abs(aabb.maxX - aabb.minX),
            Math.abs(aabb.maxY - aabb.minY),
            Math.abs(aabb.maxZ - aabb.minZ)
        ];
        aabbCenter = [
            (aabb.minX + aabb.maxX) / 2,
            (aabb.minY + aabb.maxY) / 2,
            (aabb.minZ + aabb.maxZ) / 2
        ];

        const childIds = new Set(childBoards.map(b => b.id.toString()));
        isGlued = Object.values(constraints).some(c => 
            c.type === 'Glue' && childIds.has(c.boardAId) && childIds.has(c.boardBId)
        );
    }

    const handleDimensionChange = (dimension, value) => {
        if (!meta) return;
        let key = '';
        if (dimension === 'X') {
            key = 'width';
        } else if (dimension === 'Y') {
            key = 'height';
        } else if (dimension === 'Z') {
            key = 'depth';
        }
        
        let numVal = parseFloat(value);
        if (units === 'metric' && !isNaN(numVal)) {
            numVal = numVal / 25.4;
        }
        
        const newParams = { ...(meta.params || {}), [key]: isNaN(numVal) ? value : numVal };
        const cfg = { ...newParams, editGroupId: selectedGroup };
        const state = useStore.getState();
        
        if (meta.builder === 'cabinet') state.buildCabinet(cfg);
        else if (meta.builder === 'box') state.buildBox(cfg);
        else if (meta.builder === 'shaker-door') state.buildShakerDoor(cfg);
        else if (meta.builder === 'drawerStack') state.buildDrawers(cfg);
        else if (meta.builder === 'face-frame') {
            if (state.buildFaceFrame) state.buildFaceFrame(cfg);
        } else if (meta.builder === 'shelving') {
            if (state.buildShelving) state.buildShelving(cfg);
        } else if (meta.builder === 'table-base') {
            if (state.buildTableBase) state.buildTableBase(cfg);
        } else if (meta.builder === 'table-top') {
            if (state.buildTableTop) state.buildTableTop(cfg);
        }
    };

    // Sticky banner — always rendered when constraint pick mode is active
    const ConstraintBanner = constraintTargetMode?.active ? (
        <div style={{
            padding: '10px 12px', marginBottom: '12px',
            background: 'rgba(188, 138, 95, 0.12)',
            border: '1px dashed var(--accent-color)',
            borderRadius: '8px', textAlign: 'center',
        }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-color)', marginBottom: '6px' }}>
                {constraintTargetMode.type === 'Glue'
                    ? `Click a board to glue to…`
                    : constraintTargetMode.step === 1
                        ? `Click a face on the source board…`
                        : `Click a face on the target board…`
                }
            </div>
            <button className="nav-btn"
                style={{ fontSize: '0.72rem', padding: '3px 10px', border: '1px solid var(--accent-color)' }}
                onClick={() => setConstraintTargetMode(null)}>
                Cancel (Esc)
            </button>
        </div>
    ) : null;

    return (
        <>
            {ConstraintBanner}
            <div className="inspector-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Assembly:</span>
                <input
                    type="text"
                    value={selectedGroup}
                    disabled={isWorkspace}
                    title={isWorkspace ? 'Root workspace cannot be renamed' : 'Click to rename assembly'}
                    onChange={(e) => {
                        const newName = e.target.value;
                        if (!newName.trim()) return; // don't allow empty names
                        if (newName === selectedGroup || groups[newName]) return;
                        let nextGroups = { ...groups };
                        nextGroups[newName] = nextGroups[selectedGroup];
                        delete nextGroups[selectedGroup];
                        Object.keys(nextGroups).forEach(k => {
                            if (nextGroups[k].parentId === selectedGroup) nextGroups[k].parentId = newName;
                        });
                        setGroups(nextGroups);
                        setBoards(boards.map(bd => bd.parentId === selectedGroup ? { ...bd, parentId: newName } : bd));
                        setSelectedItemIds(selectedItemIds.map(id => id === selectedGroup ? newName : id));
                    }}
                    style={{ flex: 1, width: '100%', background: isWorkspace ? 'transparent' : 'rgba(128,128,128,0.15)', padding: '6px 12px', borderRadius: '6px', border: '1px solid', borderColor: isWorkspace ? 'transparent' : 'var(--border-color)', color: 'var(--accent-color)', fontSize: 'inherit', fontWeight: 'inherit', outline: 'none' }}
                />
            </div>
            {!isWorkspace && <GizmoModeToggle />}
            <div className="inspector-card">
                <h4>Overall Dimensions ({units === 'metric' ? 'mm' : 'in'})</h4>
                <div className="vec3-inputs">
                    <div style={{ backgroundColor: 'rgba(255, 60, 60, 0.15)' }}>X<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(overallSize[0] * 25.4) : fmt4(overallSize[0])} disabled={!supportsX} onChange={val => handleDimensionChange('X', val)} style={!supportsX ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} /></div>
                    <div style={{ backgroundColor: 'rgba(60, 200, 90, 0.15)' }}>Y<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(overallSize[1] * 25.4) : fmt4(overallSize[1])} disabled={!supportsY} onChange={val => handleDimensionChange('Y', val)} style={!supportsY ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} /></div>
                    <div style={{ backgroundColor: 'rgba(60, 150, 255, 0.15)' }}>Z<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(overallSize[2] * 25.4) : fmt4(overallSize[2])} disabled={!supportsZ} onChange={val => handleDimensionChange('Z', val)} style={!supportsZ ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} /></div>
                </div>
            </div>
            {!isWorkspace && (() => {
                // Compute AABB center of all child boards
                const cx = fmt4(aabbCenter[0]);
                const cy = fmt4(aabbCenter[1]);
                const cz = fmt4(aabbCenter[2]);
                const centroid = [cx, cy, cz];

                const handleCentroidChange = (axis, newVal) => {
                    const v = parseFloat(newVal);
                    if (isNaN(v)) return;
                    const delta = v - centroid[axis];
                    if (Math.abs(delta) < 0.0001) return;
                    moveGroup(selectedGroup, axis, delta);
                };

                return (
                    <>
                        <div className="inspector-card">
                            <h4>Position ({units === 'metric' ? 'mm' : 'in'})</h4>
                            <div className="vec3-inputs">
                                <div style={{ backgroundColor: 'rgba(255, 60, 60, 0.15)' }}>X<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(centroid[0] * 25.4) : centroid[0]} onChange={val => handleCentroidChange(0, units === 'metric' ? val / 25.4 : val)} /></div>
                                <div style={{ backgroundColor: 'rgba(60, 200, 90, 0.15)' }}>Y<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(centroid[1] * 25.4) : centroid[1]} onChange={val => handleCentroidChange(1, units === 'metric' ? val / 25.4 : val)} /></div>
                                <div style={{ backgroundColor: 'rgba(60, 150, 255, 0.15)' }}>Z<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(centroid[2] * 25.4) : centroid[2]} onChange={val => handleCentroidChange(2, units === 'metric' ? val / 25.4 : val)} /></div>
                            </div>
                            <button style={{ marginTop: '8px', width: '100%' }} className="primary-btn" onClick={dropGroupToFloor}>↓ Set on Floor</button>
                            <p className="hint" style={{ marginTop: '6px' }}>Assembly center (bounding box) — changes move all children in real time.</p>
                        </div>
                        {/* ── Assembly Orientation ── */}
                        <div className="inspector-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <h4 style={{ margin: 0 }}>Assembly Orientation</h4>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>Step:</span>
                                    <select
                                        value={[5, 10, 15, 22.5, 30, 45, 90].includes(rotationStep) ? rotationStep : ''}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) setRotationStep(val);
                                        }}
                                        style={{
                                            width: '50px', padding: '2px', background: 'var(--bg-color)', color: 'var(--text-main)',
                                            border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.65rem',
                                            cursor: 'pointer', outline: 'none'
                                        }}
                                    >
                                        {[5, 10, 15, 22.5, 30, 45, 90].map(s => (
                                            <option key={s} value={s}>{s}°</option>
                                        ))}
                                        {![5, 10, 15, 22.5, 30, 45, 90].includes(rotationStep) && (
                                            <option value="" disabled>Custom</option>
                                        )}
                                    </select>
                                    <NumericInput 
                                        step="1" 
                                        value={rotationStep} 
                                        onChange={val => setRotationStep(val)} 
                                        style={{ width: '50px', padding: '2px', background: 'var(--bg-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.65rem' }} 
                                    />
                                    <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>°</span>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', marginTop: '6px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <div style={{ fontSize: '0.62rem', textAlign: 'center', color: '#ff3b30', fontWeight: 'bold' }}>Tilt Front/Back</div>
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                        <button className="nav-btn" style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem' }} onClick={() => incrementAssemblyRotation(selectedGroup, 0, -rotationStep)}>-</button>
                                        <button className="nav-btn" style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem' }} onClick={() => incrementAssemblyRotation(selectedGroup, 0, rotationStep)}>+</button>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <div style={{ fontSize: '0.62rem', textAlign: 'center', color: '#3cc85a', fontWeight: 'bold' }}>Spin Flat</div>
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                        <button className="nav-btn" style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem' }} onClick={() => incrementAssemblyRotation(selectedGroup, 1, -rotationStep)}>-</button>
                                        <button className="nav-btn" style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem' }} onClick={() => incrementAssemblyRotation(selectedGroup, 1, rotationStep)}>+</button>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <div style={{ fontSize: '0.62rem', textAlign: 'center', color: '#3c96ff', fontWeight: 'bold' }}>Tilt Left/Right</div>
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                        <button className="nav-btn" style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem' }} onClick={() => incrementAssemblyRotation(selectedGroup, 2, -rotationStep)}>-</button>
                                        <button className="nav-btn" style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem' }} onClick={() => incrementAssemblyRotation(selectedGroup, 2, rotationStep)}>+</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                );
            })()}
            {groups[selectedGroup].meta && groups[selectedGroup].meta.type === 'procedural-box' && (
                <div className="inspector-section" style={{ background: 'rgba(188, 138, 95, 0.1)', border: '1px solid rgba(188, 138, 95, 0.3)' }}>
                    <h4 style={{ color: 'var(--accent-color)' }}>Procedural Box Generator</h4>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>Joint Strategy:</span>
                        <button className="secondary-btn" style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: '100px' }} onClick={() => {
                            const cur = groups[selectedGroup].meta.joint;
                            const next = cur === 'butt-A' ? 'butt-B' : cur === 'butt-B' ? 'miter' : 'butt-A';
                            updateProceduralBox(selectedGroup, { joint: next });
                        }}>
                            {groups[selectedGroup].meta.joint === 'butt-A' ? 'Butt (Front/Back full)' : groups[selectedGroup].meta.joint === 'butt-B' ? 'Butt (Sides full)' : 'Miter'}
                        </button>
                    </div>
                    <p className="hint" style={{ marginTop: '6px' }}>Click to auto-recalculate all 4 walls.</p>
                </div>
            )}

            {!isWorkspace && (
                <div style={{ marginTop: '16px' }}>
                    <button
                        className="primary-btn"
                        style={{ 
                            width: '100%', padding: '8px', fontWeight: 'bold', marginBottom: '8px',
                            background: isGlued ? 'rgba(255, 59, 48, 0.05)' : undefined,
                            color: isGlued ? '#ff3b30' : undefined,
                            border: isGlued ? '1px solid rgba(255, 59, 48, 0.3)' : undefined,
                        }}
                        onMouseEnter={e => {
                            if (isGlued) e.target.style.background = 'rgba(255, 59, 48, 0.15)';
                        }}
                        onMouseLeave={e => {
                            if (isGlued) e.target.style.background = 'rgba(255, 59, 48, 0.05)';
                        }}
                        onClick={() => isGlued ? unglueAssembly(selectedGroup) : glueAssembly(selectedGroup)}
                    >
                        {isGlued ? 'Unglue Assembly' : 'Glue Assembly'}
                    </button>
                    {groups[selectedGroup].meta?.builder && (
                        <ParametricControls groupId={selectedGroup} meta={groups[selectedGroup].meta} />
                    )}
                    <button
                        className="primary-btn"
                        style={{ width: '100%', padding: '8px', fontWeight: 'bold', marginBottom: '8px' }}
                        onClick={() => createPivotProxy(selectedGroup)}
                    >
                        Create Pivot Proxy
                    </button>
                    {/* ── Assembly Cloning ── */}
                    <div className="inspector-card">
                        <h4 style={{ margin: '0 0 8px 0' }}>Clone Assembly</h4>
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                            <button 
                                className="nav-btn" 
                                type="button"
                                style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem', backgroundColor: cloneMode === 'local' ? 'rgba(188, 138, 95, 0.3)' : 'transparent', color: cloneMode === 'local' ? 'var(--accent-color)' : 'var(--text-main)', border: `1px solid ${cloneMode === 'local' ? 'var(--accent-color)' : 'var(--border-color)'}` }} 
                                onClick={() => setCloneMode('local')}
                            >
                                Local (Auto)
                            </button>
                            <button 
                                className="nav-btn" 
                                type="button"
                                style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem', backgroundColor: cloneMode === 'worldX' ? 'rgba(255, 59, 48, 0.3)' : 'transparent', color: '#ff3b30', border: `1px solid ${cloneMode === 'worldX' ? '#ff3b30' : 'var(--border-color)'}` }} 
                                onClick={() => setCloneMode('worldX')}
                            >
                                World X
                            </button>
                            <button 
                                className="nav-btn" 
                                type="button"
                                style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem', backgroundColor: cloneMode === 'worldY' ? 'rgba(52, 199, 89, 0.3)' : 'transparent', color: '#34c759', border: `1px solid ${cloneMode === 'worldY' ? '#34c759' : 'var(--border-color)'}` }} 
                                onClick={() => setCloneMode('worldY')}
                            >
                                World Y
                            </button>
                            <button 
                                className="nav-btn" 
                                type="button"
                                style={{ flex: 1, padding: '4px 0', fontSize: '0.72rem', backgroundColor: cloneMode === 'worldZ' ? 'rgba(0, 122, 255, 0.3)' : 'transparent', color: '#007aff', border: `1px solid ${cloneMode === 'worldZ' ? '#007aff' : 'var(--border-color)'}` }} 
                                onClick={() => setCloneMode('worldZ')}
                            >
                                World Z
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>Offset ({units === 'metric' ? 'mm' : 'in'}):</span>
                            <NumericInput 
                                step={units === 'metric' ? '10' : '1'} 
                                value={units === 'metric' ? fmt4(cloneOffset * 25.4) : fmt4(cloneOffset)} 
                                onChange={val => setCloneOffset(units === 'metric' ? val / 25.4 : val)} 
                                style={{ width: '60px', padding: '4px', background: 'var(--bg-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px' }} 
                            />
                            <button 
                                className="primary-btn" 
                                type="button"
                                style={{ flex: 1, padding: '6px 0', fontSize: '0.85rem', fontWeight: 'bold' }} 
                                onClick={() => cloneAssembly(selectedGroup, cloneMode, cloneOffset)}
                            >
                                {cloneMode === 'local' ? 'Clone (Thin Axis)' : `Clone along ${cloneMode.replace('world', '')}`}
                            </button>
                        </div>
                    </div>
                    <button
                        className="nav-btn"
                        style={{ width: '100%', padding: '8px', color: '#ff3b30', border: '1px solid rgba(255, 59, 48, 0.3)', background: 'rgba(255, 59, 48, 0.05)', fontWeight: 'bold', transition: 'background 0.2s' }}
                        onMouseEnter={e => e.target.style.background = 'rgba(255, 59, 48, 0.15)'}
                        onMouseLeave={e => e.target.style.background = 'rgba(255, 59, 48, 0.05)'}
                        onClick={handleAssemblyDelete}
                    >
                        Delete Assembly & Contents
                    </button>
                </div>
            )}
        </>
    );
};

export default AssemblyInspector;
