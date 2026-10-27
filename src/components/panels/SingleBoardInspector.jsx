import React, { useState, useEffect } from 'react';
import * as THREE from 'three';
import { normalizeMaterial, getMaterialDisplayColor, WOOD_CATALOGUE } from '../../utils/materialCatalogue';
import useStore from '../../store/useStore';
import ParametricControls from './ParametricControls';
import NumericInput from '../NumericInput';
import GizmoModeToggle from './GizmoModeToggle';


// ── Build a compact summary string for each tool type ────────────────────────
function getToolSummary(op) {
    switch (op.type) {
        case 'dado':
            return `${op.face || 'top'} surface · along ${(op.direction || 'x').toUpperCase()}`;
        case 'hole':
            return `ø=${((op.radius ?? 0) * 2).toFixed(2)}" · ${(op.axis || 'y').toUpperCase()} axis`;
        case 'cove':
            return `${op.edge || 'top'} edge · ${(op.axis || 'y').toUpperCase()} axis`;
        case 'arc':
            return `${op.startAngle ?? 0}°–${op.endAngle ?? 90}° · ${(op.axis || 'y').toUpperCase()} axis`;
        case 'miter': {
            const fl = { 'z+': 'Front', 'z-': 'Back', 'x+': 'Right', 'x-': 'Left' }[op.face] || op.face;
            const bv = op.bevel ?? 0;
            const bevelText = bv !== 0 ? ` · Bevel ${Math.abs(bv)}° ${bv > 0 ? 'Left' : 'Right'}` : '';
            return `${fl} end · ${op.angle ?? 45}°${bevelText}`;
        }
        default:
            return op.type;
    }
}

// Round to ≤4 decimal places, stripping trailing zeros
const fmt4 = (v) => parseFloat(v.toFixed(4));

const SingleBoardInspector = ({ selectedBoard }) => {
    const [cloneOffset, setCloneOffset] = useState(0.75);
    const [cloneMode, setCloneMode] = useState('local');
    const [rotationStep, setRotationStep] = useState(5.0);
    const [alignmentsOpen, setAlignmentsOpen] = useState(false);

    const {
        boards, groups, selectedItemIds, constraints, units,
        updateVector, setBoards, setSelectedItemIds, pushHistory,
        dropBoardToFloor, handleComponentDelete,
        toggleConstraint, removeConstraint,
        constraintTargetMode, setConstraintTargetMode,
        setShowToolsPanel,
        removeHardware, updateHardware, selectedHardwareId, setSelectedHardwareId,
        updateSelectedBoards, addRecordedStep,
        incrementRotation, resetRotation
    } = useStore();

    // Cancel constraint mode if selection no longer includes the source board
    useEffect(() => {
        if (constraintTargetMode?.active && constraintTargetMode.sourceId) {
            const sourceStillSelected = selectedItemIds.includes(constraintTargetMode.sourceId);
            if (!sourceStillSelected) setConstraintTargetMode(null);
        }
    }, [selectedItemIds, constraintTargetMode, setConstraintTargetMode]);

    // Escape key cancels constraint mode
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && constraintTargetMode?.active) setConstraintTargetMode(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [constraintTargetMode, setConstraintTargetMode]);



    // Sort dimensions to show Length/Width/Thickness labels
    const sorted = [...selectedBoard.size].map((v, i) => ({ val: v, idx: i })).sort((a, b) => b.val - a.val);
    const dimLabels = ['Length', 'Width', 'Thickness'];

    // Find all constraints involving this board from the central index
    const boardConstraints = Object.entries(constraints || {}).filter(([, c]) =>
        c.boardAId === selectedBoard.id.toString() || c.boardBId === selectedBoard.id.toString()
    );
    const glueConstraints = boardConstraints.filter(([, c]) => c.type === 'Glue');
    const flushConstraints = boardConstraints.filter(([, c]) => c.type === 'Flush');

    const handleClone = () => {
        if (!selectedBoard) return;
        
        const newPos = [...selectedBoard.position];

        if (cloneMode === 'local') {
            const minSize = Math.min(...selectedBoard.size);
            const thickAxis = selectedBoard.size.indexOf(minSize);
            
            const dx = thickAxis === 0 ? cloneOffset : 0;
            const dy = thickAxis === 1 ? cloneOffset : 0;
            const dz = thickAxis === 2 ? cloneOffset : 0;

            const [rx, ry, rz] = selectedBoard.orientation || [0, 0, 0];
            let wx = dx, wy = dy, wz = dz;
            if (rx !== 0 || ry !== 0 || rz !== 0) {
                const a = Math.cos(rx), sb = Math.sin(rx);
                const c = Math.cos(ry), d = Math.sin(ry);
                const ce = Math.cos(rz), f = Math.sin(rz);
                const cce = c*ce, ccf = c*f, de = d*ce, df = d*f;
                wx = (cce+df*sb)*dx + (de*sb-ccf)*dy + (a*d)*dz;
                wy = (a*f)*dx + (a*ce)*dy + (-sb)*dz;
                wz = (ccf*sb-de)*dx + (df+cce*sb)*dy + (a*c)*dz;
            }

            newPos[0] += wx;
            newPos[1] += wy;
            newPos[2] += wz;
        } else {
            const axisIndex = cloneMode === 'worldX' ? 0 : cloneMode === 'worldY' ? 1 : 2;
            newPos[axisIndex] += cloneOffset;
        }

        const maxId = Math.max(...boards.map(b => parseInt(b.id) || 0), 0);
        const newId = maxId + 1;

        const newBoard = {
            ...selectedBoard,
            id: newId,
            position: newPos,
            constraints: []
        };

        const match = selectedBoard.name.match(/^(.*?)(?:\s\d+)?$/);
        const baseName = match ? match[1].trim() : selectedBoard.name.trim();
        let maxIdx = 0;
        boards.forEach(b => {
            if (b.name === baseName) {
                maxIdx = Math.max(maxIdx, 1);
            } else {
                const m = b.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s(\\d+)$`));
                if (m) maxIdx = Math.max(maxIdx, parseInt(m[1]));
            }
        });

        newBoard.name = `${baseName} ${maxIdx > 0 ? maxIdx + 1 : 2}`;

        if (addRecordedStep) {
            const formatVal = (val) => {
                if (units === 'metric') {
                    return `${(val * 25.4).toFixed(0)} mm`;
                }
                const standardFraction = val === 0.75 ? ' (3/4")' : val === 0.5 ? ' (1/2")' : val === 0.25 ? ' (1/4")' : val === 0.375 ? ' (3/8")' : '';
                return `${parseFloat(val.toFixed(4))}"${standardFraction}`;
            };

            const offsetStr = formatVal(cloneOffset);
            let modeBtn = 'Local (Auto)';
            if (cloneMode === 'worldX') modeBtn = 'World X';
            else if (cloneMode === 'worldY') modeBtn = 'World Y';
            else if (cloneMode === 'worldZ') modeBtn = 'World Z';

            const btnName = cloneMode === 'local' ? 'Clone (Thin Axis)' : `Clone along ${cloneMode.replace('world', '')}`;

            const stepText = `In the Inspector Panel for \`${selectedBoard.name}\`, under **Clone Component**:\n` +
                `*   Click the **${modeBtn}** button.\n` +
                `*   Set the **Offset** to \`${offsetStr}\`.\n` +
                `Click **${btnName}** to create a clone named \`${newBoard.name}\`.`;

            addRecordedStep(stepText);
        }

        pushHistory();
        setBoards([...boards, newBoard]);
        setSelectedItemIds([newId.toString()]);
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
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Board:</span>
                <input
                    type="text"
                    value={selectedBoard.name || ''}
                    onChange={(e) => {
                        const newName = e.target.value;
                        setBoards(boards.map(b => 
                            b.id === selectedBoard.id ? { ...b, name: newName } : b
                        ));
                    }}
                    style={{ flex: 1, width: '100%', background: 'rgba(128,128,128,0.15)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', color: 'var(--accent-color)', fontSize: 'inherit', fontWeight: 'inherit', outline: 'none' }}
                />
            </div>
            <GizmoModeToggle />

            <div className="inspector-card">
                <h4>Size ({units === 'metric' ? 'mm' : 'in'})</h4>
                <div className="vec3-inputs">
                    <div style={{ backgroundColor: 'rgba(255, 60, 60, 0.15)' }}>X<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(selectedBoard.size[0] * 25.4) : fmt4(selectedBoard.size[0])} onChange={val => updateVector('size', 0, units === 'metric' ? val / 25.4 : val)} /></div>
                    <div style={{ backgroundColor: 'rgba(60, 200, 90, 0.15)' }}>Y<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(selectedBoard.size[1] * 25.4) : fmt4(selectedBoard.size[1])} onChange={val => updateVector('size', 1, units === 'metric' ? val / 25.4 : val)} /></div>
                    <div style={{ backgroundColor: 'rgba(60, 150, 255, 0.15)' }}>Z<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(selectedBoard.size[2] * 25.4) : fmt4(selectedBoard.size[2])} onChange={val => updateVector('size', 2, units === 'metric' ? val / 25.4 : val)} /></div>
                </div>
                <div className="hint" style={{ marginTop: '6px', fontSize: '0.75rem' }}>
                    {sorted.map((d, i) => {
                        const val = units === 'metric' ? `${(d.val * 25.4).toFixed(1)}mm` : `${d.val.toFixed(2)}"`;
                        return `${dimLabels[i]}: ${val} (${['X', 'Y', 'Z'][d.idx]})`;
                    }).join(' · ')}
                </div>
            </div>

            <div className="inspector-card">
                <h4>Position ({units === 'metric' ? 'mm' : 'in'})</h4>
                <div className="vec3-inputs">
                    <div style={{ backgroundColor: 'rgba(255, 60, 60, 0.15)' }}>X<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(selectedBoard.position[0] * 25.4) : fmt4(selectedBoard.position[0])} onChange={val => updateVector('position', 0, units === 'metric' ? val / 25.4 : val)} /></div>
                    <div style={{ backgroundColor: 'rgba(60, 200, 90, 0.15)' }}>Y<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(selectedBoard.position[1] * 25.4) : fmt4(selectedBoard.position[1])} onChange={val => updateVector('position', 1, units === 'metric' ? val / 25.4 : val)} /></div>
                    <div style={{ backgroundColor: 'rgba(60, 150, 255, 0.15)' }}>Z<NumericInput step={units === 'metric' ? '1' : '0.125'} value={units === 'metric' ? fmt4(selectedBoard.position[2] * 25.4) : fmt4(selectedBoard.position[2])} onChange={val => updateVector('position', 2, units === 'metric' ? val / 25.4 : val)} /></div>
                </div>
                <button style={{ marginTop: '8px', width: '100%' }} className="primary-btn" onClick={dropBoardToFloor}>↓ Set on Floor</button>
            </div>

            {/* ── Pivot Point ── */}
            <div className="inspector-card">
                <h4>Pivot Point ({units === 'metric' ? 'mm' : 'in'})</h4>
                {(() => {
                    const pivot = selectedBoard.pivot || [0, 0, 0];
                    const hasPivot = pivot[0] !== 0 || pivot[1] !== 0 || pivot[2] !== 0;
                    const hx = selectedBoard.size[0] / 2;
                    const hy = selectedBoard.size[1] / 2;
                    const hz = selectedBoard.size[2] / 2;

                    // Build preset list: [label, [px, py, pz]]
                    const presets = [
                        ['Center', [0, 0, 0]],
                        // Face centers
                        ['Top Face',    [0,  hy, 0]],
                        ['Bottom Face', [0, -hy, 0]],
                        ['Front Face',  [0, 0,  hz]],
                        ['Back Face',   [0, 0, -hz]],
                        ['Right Face',  [ hx, 0, 0]],
                        ['Left Face',   [-hx, 0, 0]],
                        // Bottom corners
                        ['Bottom-Left-Front',   [-hx, -hy,  hz]],
                        ['Bottom-Right-Front',  [ hx, -hy,  hz]],
                        ['Bottom-Left-Back',    [-hx, -hy, -hz]],
                        ['Bottom-Right-Back',   [ hx, -hy, -hz]],
                        // Top corners
                        ['Top-Left-Front',      [-hx,  hy,  hz]],
                        ['Top-Right-Front',     [ hx,  hy,  hz]],
                        ['Top-Left-Back',       [-hx,  hy, -hz]],
                        ['Top-Right-Back',      [ hx,  hy, -hz]],
                    ];

                    // Find which preset matches the current pivot
                    const matchIdx = presets.findIndex(([, p]) =>
                        Math.abs(p[0] - pivot[0]) < 0.001 &&
                        Math.abs(p[1] - pivot[1]) < 0.001 &&
                        Math.abs(p[2] - pivot[2]) < 0.001
                    );

                    const handlePresetChange = (e) => {
                        const idx = parseInt(e.target.value);
                        if (isNaN(idx) || idx < 0) return;
                        const [_, newPivot] = presets[idx];
                        pushHistory();
                        setBoards(prev => prev.map(bd => {
                            if (bd.id !== selectedBoard.id) return bd;
                            const oldPiv = bd.pivot || [0, 0, 0];
                            const np = newPivot[0] === 0 && newPivot[1] === 0 && newPivot[2] === 0 ? undefined : [...newPivot];
                            const dx = (np ? np[0] : 0) - oldPiv[0];
                            const dy = (np ? np[1] : 0) - oldPiv[1];
                            const dz = (np ? np[2] : 0) - oldPiv[2];
                            // Rotate the delta through the board's orientation so position stays correct
                            const [rx, ry, rz] = bd.orientation || [0, 0, 0];
                            let wx = dx, wy = dy, wz = dz;
                            if (rx !== 0 || ry !== 0 || rz !== 0) {
                                const a = Math.cos(rx), sb = Math.sin(rx);
                                const c = Math.cos(ry), d = Math.sin(ry);
                                const ce = Math.cos(rz), f = Math.sin(rz);
                                const cce = c*ce, ccf = c*f, de = d*ce, df = d*f;
                                wx = (cce+df*sb)*dx + (de*sb-ccf)*dy + (a*d)*dz;
                                wy = (a*f)*dx + (a*ce)*dy + (-sb)*dz;
                                wz = (ccf*sb-de)*dx + (df+cce*sb)*dy + (a*c)*dz;
                            }
                            return {
                                ...bd,
                                pivot: np,
                                position: [bd.position[0] + wx, bd.position[1] + wy, bd.position[2] + wz],
                            };
                        }));
                    };

                    const handleReset = () => {
                        pushHistory();
                        setBoards(prev => prev.map(bd => {
                            if (bd.id !== selectedBoard.id) return bd;
                            const oldPiv = bd.pivot || [0, 0, 0];
                            // Reverse: new pivot is [0,0,0], so delta = -oldPiv
                            const dx = -oldPiv[0], dy = -oldPiv[1], dz = -oldPiv[2];
                            const [rx, ry, rz] = bd.orientation || [0, 0, 0];
                            let wx = dx, wy = dy, wz = dz;
                            if (rx !== 0 || ry !== 0 || rz !== 0) {
                                const a = Math.cos(rx), sb = Math.sin(rx);
                                const c = Math.cos(ry), d = Math.sin(ry);
                                const ce = Math.cos(rz), f = Math.sin(rz);
                                const cce = c*ce, ccf = c*f, de = d*ce, df = d*f;
                                wx = (cce+df*sb)*dx + (de*sb-ccf)*dy + (a*d)*dz;
                                wy = (a*f)*dx + (a*ce)*dy + (-sb)*dz;
                                wz = (ccf*sb-de)*dx + (df+cce*sb)*dy + (a*c)*dz;
                            }
                            return {
                                ...bd,
                                pivot: undefined,
                                position: [bd.position[0] + wx, bd.position[1] + wy, bd.position[2] + wz],
                            };
                        }));
                    };

                    return (
                        <>
                            <select
                                value={matchIdx >= 0 ? matchIdx : -1}
                                onChange={handlePresetChange}
                                style={{
                                    width: '100%', padding: '6px 8px', marginTop: '4px',
                                    background: 'var(--bg-color)', color: 'var(--text-main)',
                                    border: `1px solid ${hasPivot ? 'rgba(255, 0, 255, 0.5)' : 'var(--border-color)'}`,
                                    borderRadius: '6px', fontSize: '0.82rem', outline: 'none',
                                    cursor: 'pointer',
                                }}
                            >
                                {matchIdx < 0 && <option value={-1} disabled>Custom ({pivot.map(v => (units === 'metric' ? (v * 25.4).toFixed(1) : v.toFixed(2))).join(', ')}{units === 'metric' ? ' mm' : ''})</option>}
                                {presets.map(([label], idx) => (
                                    <option key={idx} value={idx}>{label}</option>
                                ))}
                            </select>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px' }}>
                                <button
                                    className="primary-btn"
                                    style={{
                                        height: '24px',
                                        lineHeight: '22px',
                                        padding: '0 8px',
                                        fontSize: '0.72rem',
                                        borderColor: constraintTargetMode && constraintTargetMode.active && constraintTargetMode.type === 'PivotPick' ? 'var(--accent-color)' : undefined,
                                        background: constraintTargetMode && constraintTargetMode.active && constraintTargetMode.type === 'PivotPick' ? 'rgba(188, 138, 95, 0.15)' : undefined,
                                        color: constraintTargetMode && constraintTargetMode.active && constraintTargetMode.type === 'PivotPick' ? 'var(--accent-color)' : undefined
                                    }}
                                    onClick={() => {
                                        if (constraintTargetMode && constraintTargetMode.active && constraintTargetMode.type === 'PivotPick') {
                                            setConstraintTargetMode(null);
                                        } else {
                                            setConstraintTargetMode({ active: true, type: 'PivotPick', sourceId: selectedBoard.id.toString() });
                                        }
                                    }}
                                >
                                    🎯 {constraintTargetMode && constraintTargetMode.active && constraintTargetMode.type === 'PivotPick' ? 'Picking Point...' : 'Pick Point on Board'}
                                </button>
                                <button
                                    className="nav-btn"
                                    style={{ height: '24px', lineHeight: '22px', padding: '0 8px', fontSize: '0.72rem', border: '1px solid var(--border-color)' }}
                                    onClick={handleReset}
                                    disabled={!hasPivot}
                                >
                                    Reset to Center
                                </button>
                            </div>
                        </>
                    );
                })()}
            </div>

            {/* ── Orientation (Local rotation increments) ── */}
            <div className="inspector-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0 }}>Local Orientation</h4>
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
                        <div style={{ fontSize: '0.62rem', textAlign: 'center', color: '#ff3b30', fontWeight: 'bold' }} title="Pitch (X)">Tilt Front/Back</div>
                        <div style={{ display: 'flex', gap: '2px' }}>
                            <button className="nav-btn" style={{ flex: 1, padding: '4px 0' }} onClick={() => incrementRotation(0, -rotationStep)}>-</button>
                            <button className="nav-btn" style={{ flex: 1, padding: '4px 0' }} onClick={() => incrementRotation(0, rotationStep)}>+</button>
                        </div>
                        <button className="nav-btn" style={{ padding: '2px 0', fontSize: '0.6rem' }} onClick={() => incrementRotation(0, 180)}>Flip 180</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ fontSize: '0.62rem', textAlign: 'center', color: '#3cc85a', fontWeight: 'bold' }} title="Yaw (Y)">Spin Flat</div>
                        <div style={{ display: 'flex', gap: '2px' }}>
                            <button className="nav-btn" style={{ flex: 1, padding: '4px 0' }} onClick={() => incrementRotation(1, -rotationStep)}>-</button>
                            <button className="nav-btn" style={{ flex: 1, padding: '4px 0' }} onClick={() => incrementRotation(1, rotationStep)}>+</button>
                        </div>
                        <button className="nav-btn" style={{ padding: '2px 0', fontSize: '0.6rem' }} onClick={() => incrementRotation(1, 180)}>Spin 180</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ fontSize: '0.62rem', textAlign: 'center', color: '#3c96ff', fontWeight: 'bold' }} title="Roll (Z)">Tilt Left/Right</div>
                        <div style={{ display: 'flex', gap: '2px' }}>
                            <button className="nav-btn" style={{ flex: 1, padding: '4px 0' }} onClick={() => incrementRotation(2, -rotationStep)}>-</button>
                            <button className="nav-btn" style={{ flex: 1, padding: '4px 0' }} onClick={() => incrementRotation(2, rotationStep)}>+</button>
                        </div>
                        <button className="nav-btn" style={{ padding: '2px 0', fontSize: '0.6rem' }} onClick={() => incrementRotation(2, 180)}>Flip 180</button>
                    </div>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                    <button className="nav-btn"
                        title="Reset orientation to 0° on all axes"
                        style={{ padding: '3px 7px', fontSize: '0.68rem', border: '1px solid var(--border-color)' }}
                        onClick={resetRotation}>
                        Reset Orientation
                    </button>
                </div>
                <p className="hint" style={{ marginTop: '6px' }}>Orientation is local — operations (miter, dado, etc.) stay on their original faces.</p>
            </div>

            {/* ── Active Constraints ── */}
            <div className="inspector-card">
                <h4>Active Constraints</h4>
                {glueConstraints.length === 0 ? (
                    <div className="hint" style={{ marginTop: 0 }}>No relational constraints set.</div>
                ) : (
                    <ul style={{ margin: '8px 0 16px 0', padding: 0, listStyle: 'none' }}>
                        {glueConstraints.map(([cId, c]) => {
                            const isA = c.boardAId === selectedBoard.id.toString();
                            const partnerId = isA ? c.boardBId : c.boardAId;
                            const partner = boards.find(b => b.id.toString() === partnerId);
                            const partnerName = partner?.name ?? partnerId;
                            return (
                                <li key={cId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)', padding: '6px 10px', borderRadius: '6px', marginBottom: '4px', fontSize: '0.74rem', color: 'var(--text-muted)', border: '1px solid var(--border-color)', opacity: c.enabled === false ? 0.5 : 1 }}>
                                    <span><strong>{c.type}</strong> ↔ {partnerName}</span>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button onClick={() => toggleConstraint(cId)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }} title={c.enabled === false ? 'Enable' : 'Disable'}>{c.enabled === false ? '🔓' : '🔒'}</button>
                                        <button onClick={() => removeConstraint(cId)} style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {constraintTargetMode && constraintTargetMode.active && constraintTargetMode.type === 'Glue' ? (
                    <div style={{ padding: '12px', background: 'rgba(188, 138, 95, 0.1)', border: '1px dashed var(--accent-color)', borderRadius: '6px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--accent-color)' }}>
                        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
                            Click another board to glue to "{selectedBoard.name}"...
                        </div>
                        <button className="nav-btn" style={{ fontSize: '0.75rem', padding: '4px 8px' }} onClick={() => setConstraintTargetMode(null)}>Cancel</button>
                    </div>
                ) : !(constraintTargetMode && constraintTargetMode.active) ? (
                    <button
                        className="primary-btn"
                        style={{ width: '100%', marginTop: '8px', fontSize: '0.8rem', padding: '6px 12px' }}
                        onClick={() => setConstraintTargetMode({ active: true, type: 'Glue', step: 1, sourceId: selectedBoard.id.toString(), sourceFace: null })}
                    >
                        + Add Glue
                    </button>
                ) : null}
            </div>

            {/* ── Alignments ── */}
            <div className="inspector-card">
                <div
                    onClick={() => setAlignmentsOpen(!alignmentsOpen)}
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        userSelect: 'none',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = 0.8}
                    onMouseLeave={e => e.currentTarget.style.opacity = 1}
                >
                    <h4 style={{ margin: 0 }}>Alignments ({flushConstraints.length})</h4>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {alignmentsOpen ? '▼' : '▶'}
                    </div>
                </div>
                {alignmentsOpen && (
                    <div style={{ marginTop: '10px' }}>
                        {flushConstraints.length === 0 ? (
                            <div className="hint" style={{ marginTop: 0 }}>No active alignments.</div>
                        ) : (
                            <ul style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none' }}>
                                {flushConstraints.map(([cId, c]) => {
                                    const isA = c.boardAId === selectedBoard.id.toString();
                                    const partnerId = isA ? c.boardBId : c.boardAId;
                                    const partner = boards.find(b => b.id.toString() === partnerId);
                                    const partnerName = partner?.name ?? partnerId;
                                    const axisLabel = ` (${['X', 'Y', 'Z'][c.axis]} axis)`;
                                    return (
                                        <li key={cId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)', padding: '6px 10px', borderRadius: '6px', marginBottom: '4px', fontSize: '0.74rem', color: 'var(--text-muted)', border: '1px solid var(--border-color)', opacity: c.enabled === false ? 0.5 : 1 }}>
                                            <span><strong>{c.type}</strong>{axisLabel} ↔ {partnerName}</span>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={() => toggleConstraint(cId)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }} title={c.enabled === false ? 'Enable' : 'Disable'}>{c.enabled === false ? '🔓' : '🔒'}</button>
                                                <button onClick={() => removeConstraint(cId)} style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}
                {constraintTargetMode && constraintTargetMode.active && constraintTargetMode.type === 'Flush' ? (
                    <div style={{ padding: '12px', background: 'rgba(188, 138, 95, 0.1)', border: '1px dashed var(--accent-color)', borderRadius: '6px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--accent-color)', marginTop: '8px' }}>
                        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
                            {constraintTargetMode.step === 1
                                ? `Select Source Face on ${selectedBoard.name}...`
                                : `Select Target Face on another board...`
                            }
                        </div>
                        <button className="nav-btn" style={{ fontSize: '0.75rem', padding: '4px 8px' }} onClick={() => setConstraintTargetMode(null)}>Cancel</button>
                    </div>
                ) : !(constraintTargetMode && constraintTargetMode.active) ? (
                    <button
                        className="primary-btn"
                        style={{ width: '100%', marginTop: '8px', fontSize: '0.8rem', padding: '6px 12px' }}
                        onClick={() => setConstraintTargetMode({ active: true, type: 'Flush', step: 1, sourceId: selectedBoard.id.toString(), sourceFace: null })}
                    >
                        + Add Flush Alignment
                    </button>
                ) : null}
            </div>

            {/* ── Tools ── */}
            <div className="inspector-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ margin: 0 }}>Tools</h4>
                    <button
                        onClick={() => setShowToolsPanel(true)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}
                    >{(selectedBoard.operations || []).length > 0 ? '🧰 Open Tools Panel' : '+ Add'}</button>
                </div>
                {(selectedBoard.operations || []).length === 0 ? (
                    <div className="hint" style={{ marginTop: '6px' }}>No tools applied.</div>
                ) : (
                    <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {(selectedBoard.operations || []).map(op => {
                            const icon = { hole: '◎', cove: '◡', arc: '◠', dado: '✂', miter: '⊿' }[op.type] || '●';
                            return (
                                <span key={op.id} style={{
                                    padding: '2px 8px', fontSize: '0.72rem', fontWeight: 500,
                                    borderRadius: '4px', textTransform: 'capitalize',
                                    background: op.enabled === false ? 'rgba(128,128,128,0.1)' : 'rgba(188,138,95,0.12)',
                                    border: `1px solid ${op.enabled === false ? 'var(--border-color)' : 'rgba(188,138,95,0.3)'}`,
                                    color: op.enabled === false ? 'var(--text-muted)' : 'var(--accent-color)',
                                    opacity: op.enabled === false ? 0.6 : 1,
                                }} title={getToolSummary(op)}>
                                    {icon} {op.type}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Material & Lumber Classification ── */}
            {(() => {
                const mat = normalizeMaterial(selectedBoard.material);
                const swatchColor = getMaterialDisplayColor(selectedBoard.material);
                const label = mat.type === 'color'
                    ? 'Paint'
                    : (WOOD_CATALOGUE[mat.id]?.label ?? mat.id);
                return (
                    <div className="inspector-card">
                        <h4>Material & Lumber</h4>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', marginBottom: '12px' }}>
                            <div style={{
                                width: '28px', height: '28px', borderRadius: '6px', flexShrink: 0,
                                background: swatchColor,
                                border: '1px solid var(--border-color)',
                                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
                            }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>{label}</span>
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                    {mat.type === 'color' ? mat.hex : 'Wood'}
                                </span>
                            </div>
                        </div>

                        {/* Lumber Type Segmented Control */}
                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Lumber Type</div>
                            <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                <button
                                    className="nav-btn"
                                    style={{
                                        flex: 1, padding: '4px 0', fontSize: '0.72rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                        background: selectedBoard.lumberType === 'solid' ? 'var(--accent-color)' : 'transparent',
                                        color: selectedBoard.lumberType === 'solid' ? 'white' : 'var(--text-muted)',
                                        fontWeight: selectedBoard.lumberType === 'solid' ? 'bold' : 'normal',
                                    }}
                                    onClick={() => updateSelectedBoards('lumberType', 'solid')}
                                >
                                    Solid Wood
                                </button>
                                <button
                                    className="nav-btn"
                                    style={{
                                        flex: 1, padding: '4px 0', fontSize: '0.72rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                        background: selectedBoard.lumberType === 'plywood' ? 'var(--accent-color)' : 'transparent',
                                        color: selectedBoard.lumberType === 'plywood' ? 'white' : 'var(--text-muted)',
                                        fontWeight: selectedBoard.lumberType === 'plywood' ? 'bold' : 'normal',
                                    }}
                                    onClick={() => updateSelectedBoards('lumberType', 'plywood')}
                                >
                                    Plywood
                                </button>
                            </div>
                        </div>

                        {/* Grain Direction Segmented Control */}
                        {mat.type !== 'color' && (
                            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Grain Direction</div>
                                <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                    <button
                                        className="nav-btn"
                                        style={{
                                            flex: 1, padding: '4px 0', fontSize: '0.72rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                            background: selectedBoard.grainDirection !== 'width' ? 'var(--accent-color)' : 'transparent',
                                            color: selectedBoard.grainDirection !== 'width' ? 'white' : 'var(--text-muted)',
                                            fontWeight: selectedBoard.grainDirection !== 'width' ? 'bold' : 'normal',
                                        }}
                                        onClick={() => updateSelectedBoards('grainDirection', 'length')}
                                    >
                                        ↕ Along Length
                                    </button>
                                    <button
                                        className="nav-btn"
                                        style={{
                                            flex: 1, padding: '4px 0', fontSize: '0.72rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                            background: selectedBoard.grainDirection === 'width' ? 'var(--accent-color)' : 'transparent',
                                            color: selectedBoard.grainDirection === 'width' ? 'white' : 'var(--text-muted)',
                                            fontWeight: selectedBoard.grainDirection === 'width' ? 'bold' : 'normal',
                                        }}
                                        onClick={() => updateSelectedBoards('grainDirection', 'width')}
                                    >
                                        ↔ Along Width
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* ── Parent Assembly ── */}
            <div className="inspector-card">
                <h4>Parent Node:</h4>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginBottom: '8px' }}><strong>{selectedBoard.parentId}</strong></div>
                {groups[selectedBoard.parentId]?.meta?.builder && (
                    <div style={{ marginTop: '12px', borderTop: '1px dashed var(--border-color)', paddingTop: '12px' }}>
                        <ParametricControls groupId={selectedBoard.parentId} meta={groups[selectedBoard.parentId].meta} />
                    </div>
                )}
            </div>

            {/* ── Hardware ── */}
            <div className="inspector-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ margin: 0 }}>🔩 Hardware</h4>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{(selectedBoard.hardware || []).length} attached</span>
                </div>
                {(selectedBoard.hardware || []).length === 0 ? (
                    <div className="hint" style={{ marginTop: '6px' }}>No hardware attached. Use the Hardware panel to add hinges, pulls, etc.</div>
                ) : (
                    (selectedBoard.hardware || []).map(hw => {
                        const isHwSelected = selectedHardwareId === hw.id;
                        return (
                            <div key={hw.id}
                                onClick={() => setSelectedHardwareId(isHwSelected ? null : hw.id)}
                                style={{
                                    padding: '8px', marginTop: '6px',
                                    background: isHwSelected ? 'rgba(188,138,95,0.12)' : 'rgba(255,255,255,0.03)',
                                    border: `1px solid ${isHwSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                                        {hw.name}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeHardware(selectedBoard.id, hw.id);
                                        }}
                                        style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, padding: '1px 5px' }}
                                    >✕ Remove</button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '0.72rem' }}>
                                    <div>
                                        <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Face</div>
                                        <select
                                            value={hw.face}
                                            onChange={e => updateHardware(selectedBoard.id, hw.id, { face: e.target.value })}
                                            onClick={e => e.stopPropagation()}
                                            style={{ width: '100%', padding: '3px', background: 'var(--bg-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.75rem' }}
                                        >
                                            {['front','back','left','right','top','bottom'].map(f => (
                                                <option key={f} value={f}>{f}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Scale</div>
                                        <input
                                            type="number" step="0.1" min="0.1" max="5"
                                            value={hw.scale || 1}
                                            onChange={e => updateHardware(selectedBoard.id, hw.id, { scale: parseFloat(e.target.value) || 1 })}
                                            onClick={e => e.stopPropagation()}
                                            style={{ width: '100%', padding: '3px', background: 'var(--bg-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.75rem' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ marginTop: '4px', fontSize: '0.72rem' }}>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>Offset (X, Y, Standoff)</div>
                                    <div style={{ display: 'flex', gap: '4px', minWidth: 0 }}>
                                        {[0, 1, 2].map(i => (
                                            <NumericInput
                                                key={i}
                                                step="0.125"
                                                value={hw.offset?.[i] || 0}
                                                onChange={val => {
                                                    const newOffset = [...(hw.offset || [0, 0, 0])];
                                                    newOffset[i] = val;
                                                    updateHardware(selectedBoard.id, hw.id, { offset: newOffset });
                                                }}
                                                onClick={e => e.stopPropagation()}
                                                style={{ flex: 1, minWidth: 0, width: 0, padding: '3px', background: 'var(--bg-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.72rem' }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* ── Cloning ── */}
            <div className="inspector-card">
                <h4>Clone Component</h4>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', marginBottom: '8px' }}>
                    <button 
                        className="nav-btn" 
                        style={{ flex: 1, padding: '4px 0', fontSize: '0.75rem', backgroundColor: cloneMode === 'local' ? 'rgba(188, 138, 95, 0.3)' : 'transparent', color: cloneMode === 'local' ? 'var(--accent-color)' : 'var(--text-main)', border: `1px solid ${cloneMode === 'local' ? 'var(--accent-color)' : 'var(--border-color)'}` }} 
                        onClick={() => setCloneMode('local')}
                    >
                        Local (Auto)
                    </button>
                    <button 
                        className="nav-btn" 
                        style={{ flex: 1, padding: '4px 0', fontSize: '0.75rem', backgroundColor: cloneMode === 'worldX' ? 'rgba(255, 59, 48, 0.3)' : 'transparent', color: '#ff3b30', border: `1px solid ${cloneMode === 'worldX' ? '#ff3b30' : 'var(--border-color)'}` }} 
                        onClick={() => setCloneMode('worldX')}
                    >
                        World X
                    </button>
                    <button 
                        className="nav-btn" 
                        style={{ flex: 1, padding: '4px 0', fontSize: '0.75rem', backgroundColor: cloneMode === 'worldY' ? 'rgba(52, 199, 89, 0.3)' : 'transparent', color: '#34c759', border: `1px solid ${cloneMode === 'worldY' ? '#34c759' : 'var(--border-color)'}` }} 
                        onClick={() => setCloneMode('worldY')}
                    >
                        World Y
                    </button>
                    <button 
                        className="nav-btn" 
                        style={{ flex: 1, padding: '4px 0', fontSize: '0.75rem', backgroundColor: cloneMode === 'worldZ' ? 'rgba(0, 122, 255, 0.3)' : 'transparent', color: '#007aff', border: `1px solid ${cloneMode === 'worldZ' ? '#007aff' : 'var(--border-color)'}` }} 
                        onClick={() => setCloneMode('worldZ')}
                    >
                        World Z
                    </button>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem' }}>Offset (in):</span>
                    <NumericInput step="0.125" value={cloneOffset} onChange={val => setCloneOffset(val)} style={{ width: '60px', padding: '4px', background: 'var(--bg-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px' }} />
                    <button className="primary-btn" style={{ flex: 1, padding: '4px 0', fontSize: '0.9rem' }} onClick={handleClone}>
                        {cloneMode === 'local' ? 'Clone (Thin Axis)' : `Clone along ${cloneMode.replace('world', '')}`}
                    </button>
                </div>
            </div>


            {/* ── Delete Component ── */}
            <div style={{ marginTop: '16px' }}>
                <button
                    className="nav-btn"
                    style={{ width: '100%', padding: '8px', color: '#ff3b30', border: '1px solid rgba(255, 59, 48, 0.3)', background: 'rgba(255, 59, 48, 0.05)', fontWeight: 'bold', transition: 'background 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 59, 48, 0.15)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 59, 48, 0.05)'}
                    onClick={handleComponentDelete}
                >
                    Delete Component
                </button>
            </div>
        </>
    );
};

export const PlaneInspector = ({ selectedBoard }) => {
    const { updateSelectedBoards, handleComponentDelete, createSlabFromPlane, cutBoardWithPlane, boards } = useStore();
    const centroid = selectedBoard.centroid || [0, 0, 0];
    const normal = selectedBoard.normal || [0, 0, 1];

    const [slabWidth, setSlabWidth] = useState(24);
    const [slabHeight, setSlabHeight] = useState(24);
    const [slabThickness, setSlabThickness] = useState(0.75);
    const [slabName, setSlabName] = useState('Slab Board');
    const [thicknessDirection, setThicknessDirection] = useState('up');
    const [cutTargetId, setCutTargetId] = useState('');

    return (
        <div className="inspector-panel-content">
            <div className="inspector-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Plane:</span>
                <input
                    type="text"
                    value={selectedBoard.name || ''}
                    onChange={(e) => {
                        const newName = e.target.value;
                        updateSelectedBoards('name', newName);
                    }}
                    style={{
                        background: 'none', border: 'none', borderBottom: '1px solid transparent',
                        color: 'var(--text-main)', fontSize: '1rem', fontWeight: 'bold', width: '100%',
                        outline: 'none', padding: '2px 0'
                    }}
                    onFocus={(e) => e.target.style.borderBottom = '1px solid var(--accent-color)'}
                    onBlur={(e) => e.target.style.borderBottom = '1px solid transparent'}
                />
            </div>
            
            <div className="inspector-card">
                <h4>Centroid</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '0.8rem', marginTop: '6px' }}>
                    <div>
                        <span style={{ color: 'var(--text-muted)' }}>X:</span> {fmt4(centroid[0])}"
                    </div>
                    <div>
                        <span style={{ color: 'var(--text-muted)' }}>Y:</span> {fmt4(centroid[1])}"
                    </div>
                    <div>
                        <span style={{ color: 'var(--text-muted)' }}>Z:</span> {fmt4(centroid[2])}"
                    </div>
                </div>
            </div>

            <div className="inspector-card">
                <h4>Normal Vector</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '0.8rem', marginTop: '6px' }}>
                    <div>
                        <span style={{ color: 'var(--text-muted)' }}>X:</span> {fmt4(normal[0])}
                    </div>
                    <div>
                        <span style={{ color: 'var(--text-muted)' }}>Y:</span> {fmt4(normal[1])}
                    </div>
                    <div>
                        <span style={{ color: 'var(--text-muted)' }}>Z:</span> {fmt4(normal[2])}
                    </div>
                </div>
            </div>

            {/* Slab Conversion & Plane Cutting Tools */}
            <div className="inspector-card" style={{
                background: 'rgba(0, 243, 255, 0.04)',
                borderColor: 'rgba(0, 243, 255, 0.25)',
                marginTop: '12px',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(0, 243, 255, 0.25)'
            }}>
                <h4 style={{ color: '#00f3ff', margin: '0 0 6px 0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📐 Plane Operations
                </h4>
                <p className="hint" style={{ marginTop: '2px', marginBottom: '8px', fontSize: '0.66rem' }}>
                    Convert this plane to a slab board or use it to cut another board.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px 8px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Slab Conversion Options</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        <div>
                            <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Width (in)</div>
                            <NumericInput min="1" step="0.5" value={slabWidth} onChange={setSlabWidth} style={{ width: '100%', fontSize: '0.7rem' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Height (in)</div>
                            <NumericInput min="1" step="0.5" value={slabHeight} onChange={setSlabHeight} style={{ width: '100%', fontSize: '0.7rem' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Thickness (in)</div>
                            <NumericInput min="0.1" step="0.125" value={slabThickness} onChange={setSlabThickness} style={{ width: '100%', fontSize: '0.7rem' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Name</div>
                            <input
                                type="text"
                                value={slabName}
                                onChange={e => setSlabName(e.target.value)}
                                style={{
                                    width: '100%', padding: '4px 6px', background: 'var(--bg-color)', color: 'var(--text-main)',
                                    border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.7rem', outline: 'none'
                                }}
                            />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                            <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: '2px' }}>Thickness Extrusion Direction</div>
                            <select
                                value={thicknessDirection}
                                onChange={e => setThicknessDirection(e.target.value)}
                                style={{
                                    width: '100%', padding: '4px 6px', background: 'var(--bg-color)', color: 'var(--text-main)',
                                    border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.7rem', outline: 'none', cursor: 'pointer'
                                }}
                            >
                                <option value="up">Up (Along Plane Normal)</option>
                                <option value="down">Down (Opposite Plane Normal)</option>
                                <option value="centered">Centered (Centered on Plane)</option>
                            </select>
                        </div>
                    </div>
                    <button
                        className="primary-btn"
                        style={{ width: '100%', padding: '5px 10px', fontSize: '0.72rem', fontWeight: 'bold', marginTop: '4px' }}
                        onClick={() => createSlabFromPlane(
                            selectedBoard.centroid || selectedBoard.position,
                            selectedBoard.normal,
                            selectedBoard.points || [],
                            slabWidth,
                            slabHeight,
                            slabThickness,
                            slabName,
                            thicknessDirection,
                            selectedBoard.id
                        )}
                    >
                        Convert to Slab Board
                    </button>
                    
                    <div style={{ borderTop: '1px solid var(--border-color)', margin: '6px 0' }} />

                    <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cut Target Board</div>
                    <div>
                        <select
                            value={cutTargetId}
                            onChange={e => setCutTargetId(e.target.value)}
                            style={{
                                width: '100%', padding: '4px 6px', background: 'var(--bg-color)', color: 'var(--text-main)',
                                border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.7rem', outline: 'none', cursor: 'pointer'
                            }}
                        >
                            <option value="">-- Select board to cut --</option>
                            {boards.filter(b => b.id.toString() !== selectedBoard.id.toString() && b.shape !== 'plane').map(b => (
                                <option key={b.id} value={b.id.toString()}>{b.name}</option>
                            ))}
                        </select>
                    </div>
                    
                    <button
                        className="primary-btn"
                        style={{
                            width: '100%', padding: '6px 10px', fontSize: '0.72rem', fontWeight: 'bold',
                            background: 'rgba(255, 140, 50, 0.15)', borderColor: 'rgba(255, 140, 50, 0.35)', color: '#ff8c32'
                        }}
                        disabled={!cutTargetId}
                        onClick={() => {
                            if (cutTargetId) {
                                cutBoardWithPlane([cutTargetId], selectedBoard.centroid || selectedBoard.position, selectedBoard.normal);
                                setCutTargetId('');
                            }
                        }}
                    >
                        Cut Board with Plane
                    </button>
                </div>
            </div>

            <div className="inspector-card" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '12px' }}>
                <button
                    className="danger-btn"
                    style={{ width: '100%', padding: '8px', fontSize: '0.8rem', cursor: 'pointer', background: '#ff3b30', color: '#fff', border: 'none', borderRadius: '4px' }}
                    onClick={handleComponentDelete}
                >
                    Delete Plane
                </button>
            </div>
        </div>
    );
};

export default SingleBoardInspector;
