import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

export interface CommandPaletteAction {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  disabled?: boolean;
  run(): void;
}

interface CommandPaletteProps {
  actions: CommandPaletteAction[];
  onClose(): void;
}

export function CommandPalette({
  actions,
  onClose
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredActions = useMemo(
    () => filterActions(actions, query),
    [actions, query]
  );
  const activeAction = filteredActions[activeIndex] ?? filteredActions[0];

  function choose(action: CommandPaletteAction | undefined): void {
    if (!action || action.disabled) {
      return;
    }
    action.run();
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        filteredActions.length === 0 ? 0 : (index + 1) % filteredActions.length
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        filteredActions.length === 0
          ? 0
          : (index - 1 + filteredActions.length) % filteredActions.length
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(activeAction);
    }
  }

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <div className="panel-label">Command Palette</div>
            <h2>Local Actions</h2>
          </div>
          <span>Esc</span>
        </header>
        <input
          autoFocus
          value={query}
          placeholder="Search actions..."
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="command-palette-list" role="listbox">
          {filteredActions.length === 0 ? (
            <div className="command-palette-empty">No local actions match.</div>
          ) : (
            filteredActions.map((action, index) => (
              <button
                key={action.id}
                className={index === activeIndex ? "active" : ""}
                disabled={action.disabled}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(action);
                }}
              >
                <span className="command-palette-mark">
                  {action.label.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </span>
                {action.shortcut ? <em>{action.shortcut}</em> : null}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function filterActions(
  actions: CommandPaletteAction[],
  query: string
): CommandPaletteAction[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return actions;
  }
  return actions.filter((action) =>
    `${action.label} ${action.detail}`.toLowerCase().includes(normalized)
  );
}
