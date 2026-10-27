import React, { useState, useRef } from 'react';
import { parseFraction } from '../utils/units';

/**
 * A controlled numeric input component that buffers changes in a local string state.
 * This prevents the input from resetting or losing cursor positions when typing partial
 * values (such as a lone minus sign "-", trailing decimal points "1.", or empty inputs "").
 * Now supports parsing fractional inputs (e.g. 1 1/2, 1-1/2, 3/4) and unit suffixes.
 * Restores the up/down spinner nudging arrows visually on hover/focus, and adds support
 * for ArrowUp/ArrowDown keys and mouse wheel scroll nudging.
 */
const NumericInput = ({ value, onChange, ...props }) => {
    const [prevValue, setPrevValue] = useState(value);
    const [localVal, setLocalVal] = useState(value !== undefined && value !== null ? value.toString() : '');
    const [isFocused, setIsFocused] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const inputRef = useRef(null);

    // Sync with external value changes (e.g., store updates, undo/redo) only when not focused.
    // Done during render as recommended by React docs to avoid post-render effects.
    // NaN !== NaN is always true, so guard against it explicitly — otherwise a
    // transiently-NaN value (e.g. a stale/dangling selection) would re-trigger
    // this branch on every render and blow React's re-render limit.
    const valueChanged = Number.isNaN(value) && Number.isNaN(prevValue) ? false : value !== prevValue;
    if (valueChanged) {
        setPrevValue(value);
        if (!isFocused) {
            setLocalVal(value !== undefined && value !== null ? value.toString() : '');
        }
    }

    // Default step is 1, but we can read it from props
    const step = props.step !== undefined ? props.step : 1;

    const handleChange = (e) => {
        const valStr = e.target.value;
        setLocalVal(valStr);

        // Try parsing to float (supporting fractions and stripping ")
        const parsed = parseFraction(valStr);
        // Only trigger onChange if we have a fully valid number
        if (!isNaN(parsed) && valStr.trim() !== '' && valStr !== '-' && valStr !== '+') {
            onChange(parsed);
        }
    };

    const handleFocus = (e) => {
        setIsFocused(true);
        if (props.onFocus) props.onFocus(e);
    };

    const handleBlur = (e) => {
        setIsFocused(false);
        // Restore external value if the current local string is invalid or empty
        const parsed = parseFraction(localVal);
        if (isNaN(parsed) || localVal.trim() === '' || localVal === '-' || localVal === '+') {
            setLocalVal(value !== undefined && value !== null ? value.toString() : '');
        } else {
            // Normalize the display string
            setLocalVal(parsed.toString());
        }
        if (props.onBlur) props.onBlur(e);
    };

    const handleNudge = (direction) => {
        const parsed = parseFraction(localVal);
        const currentVal = isNaN(parsed) ? (parseFloat(value) || 0) : parsed;
        const stepNum = parseFloat(step) || 1;
        const newVal = direction === 'up' ? currentVal + stepNum : currentVal - stepNum;

        // Round to avoid float precision issues (e.g. 0.1 + 0.2 = 0.30000000000000004)
        const rounded = parseFloat(newVal.toFixed(4));

        onChange(rounded);
        setLocalVal(rounded.toString());
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            handleNudge('up');
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            handleNudge('down');
        }
        if (props.onKeyDown) props.onKeyDown(e);
    };

    const handleWheel = (e) => {
        if (isFocused) {
            e.preventDefault();
            if (e.deltaY < 0) {
                handleNudge('up');
            } else if (e.deltaY > 0) {
                handleNudge('down');
            }
        }
        if (props.onWheel) props.onWheel(e);
    };

    // Extract style/className to apply to the wrapper, and rest to the input
    const { style, className, ...inputProps } = props;

    // Show arrows when either hovered or focused, or just keep them visible at all times
    const shouldShowArrows = true;

    return (
        <span
            className={`numeric-input-wrapper ${className || ''}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                position: 'relative',
                width: '100%',
                ...style
            }}
        >
            <input
                ref={inputRef}
                type="text"
                value={localVal}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                onWheel={handleWheel}
                style={{
                    width: '100%',
                    paddingRight: shouldShowArrows ? '16px' : '0px',
                    background: 'none',
                    border: 'none',
                    color: style?.color || 'var(--text-main)',
                    outline: 'none',
                    fontSize: style?.fontSize || '0.75rem',
                    fontWeight: style?.fontWeight || 500,
                    fontFamily: 'inherit',
                    padding: '2px 0',
                    height: '22px',
                    boxSizing: 'border-box',
                    transition: 'padding-right 0.1s ease'
                }}
                {...inputProps}
            />
            {shouldShowArrows && (
                <span
                    style={{
                        position: 'absolute',
                        right: '2px',
                        top: '0',
                        bottom: '0',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        width: '14px',
                        opacity: isHovered || isFocused ? '0.8' : '0.3',
                        cursor: 'pointer',
                        userSelect: 'none',
                        color: 'var(--text-main)',
                        transition: 'opacity 0.15s ease'
                    }}
                >
                    <span
                        onClick={() => handleNudge('up')}
                        style={{
                            height: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '8px',
                            lineHeight: '1',
                            padding: '1px 0'
                        }}
                        title="Increment"
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-color)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-main)'}
                    >
                        ▲
                    </span>
                    <span
                        onClick={() => handleNudge('down')}
                        style={{
                            height: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '8px',
                            lineHeight: '1',
                            padding: '1px 0'
                        }}
                        title="Decrement"
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-color)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-main)'}
                    >
                        ▼
                    </span>
                </span>
            )}
        </span>
    );
};

export default NumericInput;
