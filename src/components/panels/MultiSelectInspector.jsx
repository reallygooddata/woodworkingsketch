import React, { useState, useEffect } from 'react';
import { computeWorldAABB, collectChildBoards } from '../../utils/sceneGraph';
import useStore from '../../store/useStore';
import { analyzeTouchConnection } from '../../utils/fastenerAnalyzer';
import NumericInput from '../NumericInput';
import GizmoModeToggle from './GizmoModeToggle';

// Round to ≤4 decimal places, stripping trailing zeros
const fmt4 = (v) => parseFloat(v.toFixed(4));



const MultiSelectInspector = () => {
    const [bulkAngleZ, setBulkAngleZ] = useState(2);
    const [bulkAngleX, setBulkAngleX] = useState(2); // Kept in state for safety and future parity
    const [fastenerType, setFastenerType] = useState('dowels');
    const [fastenerSpacing, setFastenerSpacing] = useState(8);

    const {
        boards, groups, selectedItemIds,
        setBoards, pushHistory, dropSelectionToFloor, handleMultiDelete,
        constraintTargetMode, setConstraintTargetMode,
        applySmartFasteners, removeSmartFasteners,
        updateSelectedBoards, units, addRecordedStep,
        setBoardGapOnAxis
    } = useStore();

    // Collect all boards that are part of this selection (direct boards + children of selected groups)
    const selectedBoardSet = new Set();
    selectedItemIds.forEach(id => {
        const board = boards.find(b => b.id.toString() === id);
        if (board) {
            selectedBoardSet.add(board);
        } else if (groups[id]) {
            collectChildBoards(id, boards, groups).forEach(b => selectedBoardSet.add(b));
        }
    });

    const selBoards = Array.from(selectedBoardSet).filter(b => b.shape !== 'plane');

    // Signed gap between two boards' facing extents on one world axis.
    // Positive = separated by that much; negative = overlapping by that much.
    const gapOnAxis = (axis) => {
        if (selBoards.length !== 2) return 0;
        const [a, b] = selBoards;
        const aMin = a.position[axis] - a.size[axis] / 2;
        const aMax = a.position[axis] + a.size[axis] / 2;
        const bMin = b.position[axis] - b.size[axis] / 2;
        const bMax = b.position[axis] + b.size[axis] / 2;
        return Math.max(bMin - aMax, aMin - bMax);
    };

    // Compute bulk states
    const allSolid = selBoards.length > 0 && selBoards.every(b => b.lumberType === 'solid');
    const allPlywood = selBoards.length > 0 && selBoards.every(b => b.lumberType === 'plywood');
    const allLengthGrain = selBoards.length > 0 && selBoards.every(b => b.grainDirection === 'length');
    const allWidthGrain = selBoards.length > 0 && selBoards.every(b => b.grainDirection === 'width');

    // Analyze touch connection when exactly 2 boards are selected
    let touchAnalysis = null;
    let hasExistingFasteners = false;
    let calculatedCount = 2;
    if (selBoards.length === 2) {
        touchAnalysis = analyzeTouchConnection(selBoards[0], selBoards[1]);
        const bA = selBoards[0];
        const bB = selBoards[1];
        const hasOps = bA.operations?.some(op => op.source === 'smart-fastener') || 
                       bB.operations?.some(op => op.source === 'smart-fastener');
        const hasGroup = Object.keys(groups).some(k => k === `fasteners_${bA.id}_${bB.id}` || k === `fasteners_${bB.id}_${bA.id}`);
        hasExistingFasteners = hasOps || hasGroup;

        if (touchAnalysis) {
            const { overlapSpans, touchAxis } = touchAnalysis;
            let totalLength = 0;
            const spanX = overlapSpans[0];
            const spanY = overlapSpans[1];
            const spanZ = overlapSpans[2];
            if (touchAxis === 'x') {
                totalLength = spanZ > spanY ? spanZ : spanY;
            } else if (touchAxis === 'y') {
                totalLength = spanZ > spanX ? spanZ : spanX;
            } else {
                totalLength = spanY > spanX ? spanY : spanX;
            }
            const activeLength = totalLength - 4.0; // 2" margin at each end
            calculatedCount = activeLength <= 0 ? 1 : Math.max(2, Math.ceil(activeLength / fastenerSpacing) + 1);
        }
    }

    // Auto-correct fastener type if transitioning to a parallel edge-joint
    useEffect(() => {
        if (touchAnalysis && touchAnalysis.jointType === 'parallel' && fastenerType !== 'dowels' && fastenerType !== 'loose-tenon') {
            setFastenerType('dowels');
        }
    }, [touchAnalysis, fastenerType]);

    let aabb = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    let multiSize = [0, 0, 0];
    if (selBoards.length > 0) {
        aabb = computeWorldAABB(selBoards);
        multiSize = [
            fmt4(Math.abs(aabb.maxX - aabb.minX)),
            fmt4(Math.abs(aabb.maxY - aabb.minY)),
            fmt4(Math.abs(aabb.maxZ - aabb.minZ))
        ];
    }

    // For each axis: which boards have both extents touching the group AABB?
    const SNAP = 0.01;
    const aabbMins = [aabb.minX, aabb.minY, aabb.minZ];
    const aabbMaxs = [aabb.maxX, aabb.maxY, aabb.maxZ];
    const spanningBoards = [0, 1, 2].map(i =>
        selBoards.filter(b => {
            const bMin = b.position[i] - b.size[i] / 2;
            const bMax = b.position[i] + b.size[i] / 2;
            return Math.abs(bMin - aabbMins[i]) < SNAP && Math.abs(bMax - aabbMaxs[i]) < SNAP;
        })
    );
    const axisEditable = spanningBoards.map(s => s.length > 0);

    const handleBBSizeChange = (i, newVal) => {
        const v = parseFloat(newVal);
        if (isNaN(v) || v <= 0) return;
        pushHistory();
        const spanIds = new Set(spanningBoards[i].map(b => b.id));
        setBoards(prev => prev.map(b => {
            if (!spanIds.has(b.id)) return b;
            const newSize = [...b.size];
            newSize[i] = v;
            const newPos = [...b.position];
            newPos[i] = aabbMins[i] + v / 2; // anchor to min-extent side
            return { ...b, size: newSize, position: newPos };
        }));
    };

    const bbRowStyle = (editable) => ({
        opacity: editable ? 1 : 0.4,
        transition: 'opacity 0.15s',
    });

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
            {touchAnalysis && (
                <div className="inspector-section" style={{
                    background: 'rgba(60, 150, 255, 0.06)',
                    border: '1px solid rgba(60, 150, 255, 0.25)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '12px'
                }}>
                    <h4 style={{ color: 'var(--accent-color)', margin: '0 0 6px 0', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        🔨 Smart Joint Fasteners
                    </h4>
                    <p className="hint" style={{ marginTop: '2px', marginBottom: '8px', fontSize: '0.66rem' }}>
                        Detected: <strong>{touchAnalysis.jointType === 'parallel' ? 'Parallel Edge Joint' : 'Right-Angle Butt Joint'}</strong>
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>
                            <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 'bold', textTransform: 'uppercase' }}>Fastener Type</div>
                            <select
                                value={fastenerType}
                                onChange={e => setFastenerType(e.target.value)}
                                style={{
                                    width: '100%', padding: '4px 6px', background: 'var(--bg-color)', color: 'var(--text-main)',
                                    border: '1px solid var(--border-color)', borderRadius: '6px', outline: 'none', fontSize: '0.75rem', cursor: 'pointer'
                                }}
                            >
                                {touchAnalysis.jointType === 'parallel' ? (
                                    <>
                                        <option value="dowels">Dowel Pins (Birch)</option>
                                        <option value="loose-tenon">Loose Tenons / Dominoes (Birch)</option>
                                    </>
                                ) : (
                                    <>
                                        <option value="pocket-hole">Pocket Holes (Contrasting Wood)</option>
                                        <option value="screws">Face Screws (Steel)</option>
                                        <option value="dowels">Dowel Pins (Birch)</option>
                                        <option value="loose-tenon">Loose Tenons / Dominoes (Birch)</option>
                                    </>
                                )}
                            </select>
                        </div>

                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                <span>Max Spacing (in)</span>
                                <span style={{ color: 'var(--text-main)' }}>{fastenerSpacing}" (Qty: {calculatedCount})</span>
                            </div>
                            <input
                                type="range" min="3" max="24" step="1"
                                value={fastenerSpacing}
                                onChange={e => setFastenerSpacing(parseInt(e.target.value, 10))}
                                style={{ width: '100%', accentColor: 'var(--accent-color)', height: '4px', cursor: 'pointer', outline: 'none' }}
                            />
                            <p className="hint" style={{ fontSize: '0.58rem', marginTop: '2px' }}>Auto-spaced with 2" end margins to prevent splitting.</p>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                            <button
                                className="primary-btn"
                                style={{ flex: 1, padding: '5px 10px', fontSize: '0.72rem', fontWeight: 'bold' }}
                                onClick={() => applySmartFasteners(selBoards[0].id, selBoards[1].id, { type: fastenerType, count: calculatedCount })}
                            >
                                {hasExistingFasteners ? 'Update Joint' : 'Apply Fasteners'}
                            </button>
                            {hasExistingFasteners && (
                                <button
                                    className="nav-btn"
                                    style={{ padding: '5px 10px', fontSize: '0.72rem', color: '#ff3b30', borderColor: 'rgba(255, 59, 48, 0.3)', background: 'rgba(255, 59, 48, 0.05)', cursor: 'pointer' }}
                                    onClick={() => removeSmartFasteners(selBoards[0].id, selBoards[1].id)}
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            <div className="inspector-title" style={{ marginBottom: '16px' }}>
                <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>{selectedItemIds.length} Items Selected</span>
            </div>
            <GizmoModeToggle />
            {selBoards.length === 2 && (
                <div className="inspector-card">
                    <h4>Distance Between Boards ({units === 'metric' ? 'mm' : 'in'})</h4>
                    <div className="vec3-inputs">
                        {[0, 1, 2].map(axis => {
                            const gap = gapOnAxis(axis);
                            const label = ['X', 'Y', 'Z'][axis];
                            const bg = ['rgba(255, 60, 60, 0.15)', 'rgba(60, 200, 90, 0.15)', 'rgba(60, 150, 255, 0.15)'][axis];
                            return (
                                <div key={axis} style={{ backgroundColor: bg }}>
                                    {label}
                                    <NumericInput
                                        step={units === 'metric' ? '1' : '0.125'}
                                        value={units === 'metric' ? fmt4(gap * 25.4) : fmt4(gap)}
                                        onChange={val => setBoardGapOnAxis(
                                            selBoards[0].id, selBoards[1].id, axis,
                                            units === 'metric' ? val / 25.4 : val
                                        )}
                                    />
                                </div>
                            );
                        })}
                    </div>
                    <div className="hint" style={{ marginTop: '6px', fontSize: '0.75rem' }}>
                        Positive = gap between the boards, negative = overlap. Editing an axis moves <strong>{selBoards[0].name}</strong> — <strong>{selBoards[1].name}</strong> stays fixed.
                    </div>
                </div>
            )}
            <div className="inspector-section">
                <h4>Bounding Box (in)</h4>
                <p className="hint" style={{ marginTop: '2px', marginBottom: '6px' }}>
                    Editable axes span all selected boards.
                </p>
                <div className="vec3-inputs">
                    <div style={{ backgroundColor: 'rgba(255, 60, 60, 0.15)', ...bbRowStyle(axisEditable[0]) }}>
                        X<NumericInput step="0.125" value={multiSize[0]}
                            disabled={!axisEditable[0]}
                            onChange={val => handleBBSizeChange(0, val)} />
                    </div>
                    <div style={{ backgroundColor: 'rgba(60, 200, 90, 0.15)', ...bbRowStyle(axisEditable[1]) }}>
                        Y<NumericInput step="0.125" value={multiSize[1]}
                            disabled={!axisEditable[1]}
                            onChange={val => handleBBSizeChange(1, val)} />
                    </div>
                    <div style={{ backgroundColor: 'rgba(60, 150, 255, 0.15)', ...bbRowStyle(axisEditable[2]) }}>
                        Z<NumericInput step="0.125" value={multiSize[2]}
                            disabled={!axisEditable[2]}
                            onChange={val => handleBBSizeChange(2, val)} />
                    </div>
                </div>
                {axisEditable.some(Boolean) && (
                    <div style={{ marginTop: '5px', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {['X', 'Y', 'Z'].map((label, i) => axisEditable[i]
                            ? <span key={i} style={{ marginRight: '8px' }}>{label}: {spanningBoards[i].length} board{spanningBoards[i].length !== 1 ? 's' : ''}</span>
                            : null
                        )}
                    </div>
                )}
            </div>
            <div className="inspector-section">
                <h4>Position (in)</h4>
                <p className="hint" style={{ marginTop: '2px', marginBottom: '6px' }}>
                    Selection centroid — changes move all selected items.
                </p>
                {(() => {
                    // Compute centroid of all selected boards
                    const cx = fmt4(selBoards.reduce((s, b) => s + b.position[0], 0) / selBoards.length);
                    const cy = fmt4(selBoards.reduce((s, b) => s + b.position[1], 0) / selBoards.length);
                    const cz = fmt4(selBoards.reduce((s, b) => s + b.position[2], 0) / selBoards.length);
                    const centroid = [cx, cy, cz];

                    const handleCentroidChange = (axis, v) => {
                        const delta = v - centroid[axis];
                        if (Math.abs(delta) < 0.0001) return;
                        pushHistory();

                        if (addRecordedStep) {
                            const formatVal = (val) => {
                                if (units === 'metric') {
                                    return `${(val * 25.4).toFixed(0)} mm`;
                                }
                                const standardFraction = val === 0.75 ? ' (3/4")' : val === 0.5 ? ' (1/2")' : val === 0.25 ? ' (1/4")' : val === 0.375 ? ' (3/8")' : '';
                                return `${parseFloat(val.toFixed(4))}"${standardFraction}`;
                            };
                            const axisLabel = axis === 0 ? 'X/Red' : axis === 1 ? 'Y/Green' : 'Z/Blue';
                            addRecordedStep(`In the Multi-Select Inspector Panel, set **Position/${axisLabel} dimension** to ${formatVal(v)}.`);
                        }

                        const selIds = new Set(selBoards.map(b => b.id));
                        setBoards(prev => prev.map(b => {
                            if (!selIds.has(b.id)) return b;
                            const newPos = [...b.position];
                            newPos[axis] += delta;
                            return { ...b, position: newPos };
                        }));
                    };

                    return (
                        <div className="vec3-inputs">
                            <div style={{ backgroundColor: 'rgba(255, 60, 60, 0.15)' }}>
                                X<NumericInput step="0.125" value={centroid[0]}
                                    onChange={val => handleCentroidChange(0, val)} />
                            </div>
                            <div style={{ backgroundColor: 'rgba(60, 200, 90, 0.15)' }}>
                                Y<NumericInput step="0.125" value={centroid[1]}
                                    onChange={val => handleCentroidChange(1, val)} />
                            </div>
                            <div style={{ backgroundColor: 'rgba(60, 150, 255, 0.15)' }}>
                                Z<NumericInput step="0.125" value={centroid[2]}
                                    onChange={val => handleCentroidChange(2, val)} />
                            </div>
                        </div>
                    );
                })()}
            </div>
            <div className="inspector-section">
                <p className="hint">{selBoards.length} board{selBoards.length !== 1 ? 's' : ''} in selection. Use AI Chat for bulk transforms.</p>
                <button style={{ marginTop: '8px', width: '100%' }} className="primary-btn" onClick={dropSelectionToFloor}>↓ Set on Floor</button>
            </div>

            {/* Bulk Material & Lumber Editing Card */}
            <div className="inspector-section" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                <h4>Bulk Material & Lumber</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                    {/* Lumber Type */}
                    <div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '4px' }}>Lumber Type</div>
                        <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                            <button
                                className="nav-btn"
                                style={{
                                    flex: 1, padding: '4px 0', fontSize: '0.72rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                    background: allSolid ? 'var(--accent-color)' : 'transparent',
                                    color: allSolid ? 'white' : 'var(--text-muted)',
                                    fontWeight: allSolid ? 'bold' : 'normal',
                                }}
                                onClick={() => updateSelectedBoards('lumberType', 'solid')}
                            >
                                Solid Wood
                            </button>
                            <button
                                className="nav-btn"
                                style={{
                                    flex: 1, padding: '4px 0', fontSize: '0.72rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                    background: allPlywood ? 'var(--accent-color)' : 'transparent',
                                    color: allPlywood ? 'white' : 'var(--text-muted)',
                                    fontWeight: allPlywood ? 'bold' : 'normal',
                                }}
                                onClick={() => updateSelectedBoards('lumberType', 'plywood')}
                            >
                                Plywood
                            </button>
                        </div>
                    </div>

                    {/* Grain Direction */}
                    <div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '4px' }}>Grain Direction</div>
                        <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                            <button
                                className="nav-btn"
                                style={{
                                    flex: 1, padding: '4px 0', fontSize: '0.72rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                    background: allLengthGrain ? 'var(--accent-color)' : 'transparent',
                                    color: allLengthGrain ? 'white' : 'var(--text-muted)',
                                    fontWeight: allLengthGrain ? 'bold' : 'normal',
                                }}
                                onClick={() => updateSelectedBoards('grainDirection', 'length')}
                            >
                                ↕ Along Length
                            </button>
                            <button
                                className="nav-btn"
                                style={{
                                    flex: 1, padding: '4px 0', fontSize: '0.72rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                    background: allWidthGrain ? 'var(--accent-color)' : 'transparent',
                                    color: allWidthGrain ? 'white' : 'var(--text-muted)',
                                    fontWeight: allWidthGrain ? 'bold' : 'normal',
                                }}
                                onClick={() => updateSelectedBoards('grainDirection', 'width')}
                            >
                                ↔ Along Width
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            {selBoards.length >= 2 && (() => {
                const areVertical = selBoards.every(b => b.size[1] > b.size[0] && b.size[1] > b.size[2]);
                if (!areVertical) return null;

                // Centroid across all selected boards in X and Z
                const cx = selBoards.reduce((s, b) => s + b.position[0], 0) / selBoards.length;
                const cz = selBoards.reduce((s, b) => s + b.position[2], 0) / selBoards.length;

                // Determine which sides face inward toward the centroid
                const applyTaper = (angle) => {
                    pushHistory();
                    const selIds = new Set(selBoards.map(b => b.id));
                    setBoards(prev => prev.map(b => {
                        if (!selIds.has(b.id)) return b;
                        // Each leg gets inward-facing sides tapered
                        const taper = {
                            angleLeft:  b.position[0] > cx ? angle : 0,
                            angleRight: b.position[0] < cx ? angle : 0,
                            angleFront: b.position[2] < cz ? angle : 0,
                            angleBack:  b.position[2] > cz ? angle : 0,
                        };
                        return { ...b, shape: 'taper', taper };
                    }));
                };

                const removeTaper = () => {
                    pushHistory();
                    const selIds = new Set(selBoards.map(b => b.id));
                    setBoards(prev => prev.map(b =>
                        selIds.has(b.id) ? { ...b, shape: undefined, taper: undefined } : b
                    ));
                };

                const allTapered = selBoards.every(b => b.shape === 'taper');

                return (
                    <div className="inspector-section" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                        <h4>Bulk Shape</h4>
                        <p className="hint" style={{ marginTop: '2px', marginBottom: '8px' }}>
                            Inward-facing sides are auto-detected from each board's position relative to the group centroid.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '3px' }}>Taper angle (°)</div>
                                <input
                                    type="number" min="0" max="89" step="0.5"
                                    value={bulkAngleZ}
                                    onChange={e => setBulkAngleZ(Math.max(0, Math.min(89, parseFloat(e.target.value) || 0)))}
                                    style={{ width: '100%', padding: '5px 8px', background: 'var(--bg-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px', outline: 'none', fontSize: '0.9rem' }}
                                />
                            </div>
                            <button className="primary-btn" onClick={() => applyTaper(bulkAngleZ)}>
                                ◢ Taper as Legs ({bulkAngleZ}°)
                            </button>
                            {allTapered && (
                                <button className="nav-btn" style={{ border: '1px solid var(--border-color)', marginTop: '2px' }} onClick={removeTaper}>
                                    ■ Remove Taper → Box
                                </button>
                            )}
                        </div>
                    </div>
                );
            })()}

            <div style={{ marginTop: '16px' }}>
                <button
                    className="nav-btn"
                    style={{ width: '100%', padding: '8px', color: '#ff3b30', border: '1px solid rgba(255, 59, 48, 0.3)', background: 'rgba(255, 59, 48, 0.05)', fontWeight: 'bold', transition: 'background 0.2s' }}
                    onMouseEnter={e => e.target.style.background = 'rgba(255, 59, 48, 0.15)'}
                    onMouseLeave={e => e.target.style.background = 'rgba(255, 59, 48, 0.05)'}
                    onClick={handleMultiDelete}
                >
                    Delete {selectedItemIds.length} Selected Items
                </button>
            </div>
        </>
    );
};

export default MultiSelectInspector;
