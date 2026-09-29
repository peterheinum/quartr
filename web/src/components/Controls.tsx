/**
 * The top control bar: pick a company, filter by form type, decide whether
 * amendments are included, and add the current ticker to the summary panel.
 *
 * This component is deliberately state-light — it owns only the transient
 * UI state a typeahead needs (the raw input text, the open dropdown, the
 * highlighted row). Everything that matters beyond a keystroke (the chosen
 * ticker, the selected forms, the amendments flag) is lifted to the parent
 * via the `on*Change` callbacks, so this component can be swapped out or
 * reset without losing application state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Company, FormCount } from "@quartr/shared";
import { searchCompanies } from "../api";
import { useFetch } from "../useFetch";

type ControlsProps = {
  ticker: string;
  company: Company | null;
  availableForms: FormCount[];
  selectedForms: string[];
  includeAmendments: boolean;
  onCompanyChange: (ticker: string) => void;
  onFormsChange: (forms: string[]) => void;
  onIncludeAmendmentsChange: (include: boolean) => void;
  onAddToSummary: (ticker: string) => void;
  inSummary: boolean;
};

/** Chips beyond this many are hidden behind "Show all" — JPMorgan alone has
 * 30+ distinct form types, and an unbounded row of chips wraps into a wall
 * of text that pushes the rest of the page down. */
const MAX_VISIBLE_CHIPS = 14;

/** How long to wait after the last keystroke before querying the server. */
const SEARCH_DEBOUNCE_MS = 250;

export function Controls({
  ticker,
  company,
  availableForms,
  selectedForms,
  includeAmendments,
  onCompanyChange,
  onFormsChange,
  onIncludeAmendmentsChange,
  onAddToSummary,
  inSummary,
}: ControlsProps) {
  const [query, setQuery] = useState(ticker);
  const [debouncedQuery, setDebouncedQuery] = useState(ticker);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [showAllChips, setShowAllChips] = useState(false);

  // Keep the input text in sync when the ticker changes from outside (e.g.
  // picking a company from the summary panel), but don't fight the user
  // while they're actively typing a new query.
  useEffect(() => {
    setQuery(ticker);
    setDebouncedQuery(ticker);
  }, [ticker]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const searchRequest = useMemo(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < 2) return null;
    return (signal: AbortSignal) => searchCompanies(trimmed, signal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const { data } = useFetch(searchRequest, [debouncedQuery]);
  const results = data?.companies ?? [];

  const selectCompany = useCallback(
    (chosenTicker: string) => {
      onCompanyChange(chosenTicker);
      setQuery(chosenTicker);
      setOpen(false);
      setHighlighted(-1);
    },
    [onCompanyChange],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length > 0) {
        setOpen(true);
        setHighlighted((index) => (index + 1) % results.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length > 0) {
        setOpen(true);
        setHighlighted((index) => (index <= 0 ? results.length - 1 : index - 1));
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && highlighted >= 0 && highlighted < results.length) {
        selectCompany(results[highlighted].ticker);
      } else if (query.trim()) {
        selectCompany(query.trim().toUpperCase());
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  };

  const toggleForm = (form: string) => {
    const next = selectedForms.includes(form)
      ? selectedForms.filter((f) => f !== form)
      : [...selectedForms, form];
    onFormsChange(next);
  };

  const visibleForms = showAllChips ? availableForms : availableForms.slice(0, MAX_VISIBLE_CHIPS);

  return (
    <div className="controls">
      <div className="field">
        <label htmlFor="company-search">Company</label>
        <div className="typeahead">
          <input
            id="company-search"
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls="company-search-results"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setHighlighted(-1);
            }}
            onFocus={() => setOpen(true)}
            // A click on a result fires mousedown before this blur, and the
            // option's own onMouseDown cancels the default focus change, so
            // the click still lands even though we close the list here.
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
          />
          {open && results.length > 0 && (
            <ul id="company-search-results" className="typeahead-results" role="listbox">
              {results.map((result, index) => (
                <li key={result.cik} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectCompany(result.ticker)}
                  >
                    <span className="ticker">{result.ticker}</span>
                    <span className="name">{result.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {company && <span className="muted">{company.name}</span>}
      </div>

      {availableForms.length > 0 && (
        <div className="field">
          <label>Form type</label>
          <div className="chips">
            {visibleForms.map((form) => (
              <button
                key={form.form}
                type="button"
                className="chip"
                aria-pressed={selectedForms.includes(form.form)}
                onClick={() => toggleForm(form.form)}
              >
                {form.form}
                <span className="count">{form.count.toLocaleString('en-US')}</span>
              </button>
            ))}
            {availableForms.length > MAX_VISIBLE_CHIPS && (
              <button type="button" className="chip" onClick={() => setShowAllChips((v) => !v)}>
                {showAllChips ? "Show fewer" : `Show all (${availableForms.length})`}
              </button>
            )}
            {selectedForms.length > 0 && (
              <button type="button" className="chip" onClick={() => onFormsChange([])}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="field">
        <label className="check" title="An amendment (e.g. 10-K/A) corrects a previously filed report and shares its reporting period, so it's excluded by default to avoid double-counting.">
          <input
            type="checkbox"
            checked={includeAmendments}
            onChange={(event) => onIncludeAmendmentsChange(event.target.checked)}
          />
          Include amendments
        </label>
      </div>

      <div className="field">
        <button type="button" className="primary" disabled={inSummary} onClick={() => onAddToSummary(ticker)}>
          {inSummary ? "In summary" : "Add to summary"}
        </button>
      </div>
    </div>
  );
}
