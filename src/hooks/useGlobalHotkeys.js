import { useEffect } from 'react';
import useStore from '../store/useStore';

export function useGlobalHotkeys({ setShowRecorderPanel }) {
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'r') {
                e.preventDefault();
                setShowRecorderPanel((prev) => !prev);
                return;
            }

            const isInput = e.target.closest('input, textarea, select, [contenteditable="true"]');
            if (isInput) return;

            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            const key = e.key.toLowerCase();

            // Undo / Redo — Ctrl/Cmd+Z (Shift = redo), and Ctrl/Cmd+Y as the
            // common Windows alternative for redo.
            if (key === 'z') {
                e.preventDefault();
                const { handleUndo, handleRedo } = useStore.getState();
                if (e.shiftKey) handleRedo(); else handleUndo();
                return;
            }
            if (key === 'y') {
                e.preventDefault();
                useStore.getState().handleRedo();
                return;
            }

            // Save the active workspace.
            if (key === 's') {
                e.preventDefault();
                useStore.getState().saveWorkspace();
                return;
            }

            // Select every board in the workspace.
            if (key === 'a') {
                e.preventDefault();
                const { boards, setSelectedItemIds } = useStore.getState();
                setSelectedItemIds(boards.map((b) => b.id.toString()));
                return;
            }

            // Duplicate the current selection.
            if (key === 'd') {
                e.preventDefault();
                useStore.getState().duplicateSelected();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [setShowRecorderPanel]);
}
