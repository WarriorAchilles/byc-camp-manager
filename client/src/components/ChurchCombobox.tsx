import { useEffect, useId, useRef, useState } from "react";
import { apiJson } from "../api";

type ChurchSuggestion = {
  id: string;
  churchName: string;
  pastorName: string;
};

type Props = {
  churchName: string;
  pastorName: string;
  selectedChurchId: string | null;
  onChange: (value: {
    churchName: string;
    pastorName: string;
    selectedChurchId: string | null;
  }) => void;
};

export function ChurchCombobox({
  churchName,
  pastorName,
  selectedChurchId,
  onChange,
}: Props): React.ReactElement {
  const listId = useId();
  const statusId = useId();
  const requestNumber = useRef(0);
  const [suggestions, setSuggestions] = useState<ChurchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "failed">("idle");

  useEffect(() => {
    const query = churchName.trim();
    if (query.length < 2 || selectedChurchId) {
      setSuggestions([]);
      setOpen(false);
      setStatus("idle");
      return;
    }
    const currentRequest = ++requestNumber.current;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      void apiJson<{ churches: ChurchSuggestion[] }>(
        `/api/public/registration/church-suggestions?q=${encodeURIComponent(query)}`,
      ).then((result) => {
        if (currentRequest !== requestNumber.current) return;
        setSuggestions(result.churches);
        setActiveIndex(result.churches.length > 0 ? 0 : -1);
        setOpen(true);
        setStatus(result.churches.length > 0 ? "idle" : "empty");
      }).catch(() => {
        if (currentRequest !== requestNumber.current) return;
        setSuggestions([]);
        setOpen(true);
        setStatus("failed");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [churchName, selectedChurchId]);

  const select = (suggestion: ChurchSuggestion): void => {
    onChange({
      churchName: suggestion.churchName,
      pastorName: suggestion.pastorName,
      selectedChurchId: suggestion.id,
    });
    setSuggestions([]);
    setOpen(false);
    setStatus("idle");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      select(suggestions[activeIndex]!);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const statusText = status === "loading"
    ? "Loading church suggestions"
    : status === "empty"
      ? "No suggestions"
      : status === "failed"
        ? "Suggestions are unavailable; you can keep typing"
        : selectedChurchId
          ? "Canonical church selected"
          : "";

  return (
    <>
      <div className="church-combobox">
        <label htmlFor={`${listId}-input`}>Church presently attending</label>
        <input
          id={`${listId}-input`}
          required
          maxLength={200}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-describedby={statusId}
          value={churchName}
          onChange={(event) => onChange({
            churchName: event.target.value,
            pastorName,
            selectedChurchId: null,
          })}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        />
        {open && suggestions.length > 0 ? (
          <ul id={listId} role="listbox" className="church-suggestions">
            {suggestions.map((suggestion, index) => (
              <li
                id={`${listId}-${index}`}
                key={suggestion.id}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(suggestion)}
              >
                {suggestion.churchName} - {suggestion.pastorName}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <label>
        Pastor full name
        <input
          required
          maxLength={200}
          value={pastorName}
          onChange={(event) => onChange({
            churchName,
            pastorName: event.target.value,
            selectedChurchId: null,
          })}
        />
      </label>
      <span id={statusId} className="registration-fine-print" aria-live="polite">
        {statusText}
      </span>
    </>
  );
}
