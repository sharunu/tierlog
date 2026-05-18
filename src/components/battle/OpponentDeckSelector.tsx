"use client";

import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";

import {
  displayDeckName,
  type OpponentDeckNameMap,
} from "@/lib/actions/opponent-deck-display";
import { matchesQuery } from "@/lib/search/normalize";

type Props = {
  majorSuggestions: string[];
  minorSuggestions: string[];
  otherSuggestions: string[];
  value: string;
  onChange: (name: string) => void;
  headerExtra?: React.ReactNode;
  nameMap?: OpponentDeckNameMap;
};

export function OpponentDeckSelector({
  majorSuggestions,
  minorSuggestions,
  otherSuggestions,
  value,
  onChange,
  headerExtra,
  nameMap,
}: Props) {
  const [showOther, setShowOther] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    if (value === "") {
      setShowOther(false);
      setShowMore(false);
      setSearchText("");
    }
  }, [value]);

  const display = (name: string) => displayDeckName(name, nameMap);

  const filterByQuery = (items: string[]) => {
    if (!searchText) return items;
    return items.filter((s) => matchesQuery(searchText, [s, display(s)]));
  };

  const filteredMajor = filterByQuery(majorSuggestions);
  const filteredMinor = filterByQuery(minorSuggestions);
  const filteredOther = filterByQuery(otherSuggestions);
  const hasSearchText = searchText.trim().length > 0;
  const noMatch =
    hasSearchText && filteredMajor.length === 0 && filteredMinor.length === 0 && filteredOther.length === 0;

  const handleSelect = (name: string) => {
    onChange(name);
    const searchUiVisible = showOther || searchText.trim().length > 0;
    if (searchUiVisible) {
      setSearchText(display(name));
    }
  };

  const chipClass = (name: string) => {
    const isSelected = value === name;
    return `rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all ${
      isSelected
        ? "bg-primary/10 border border-primary text-primary"
        : "bg-surface-2 border border-border-subtle text-foreground"
    }`;
  };

  const otherSelected = !!value && !majorSuggestions.includes(value);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] text-muted-foreground">対面デッキ</p>
        {headerExtra}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(hasSearchText ? filteredMajor : majorSuggestions).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => handleSelect(name)}
            className={chipClass(name)}
          >
            {display(name)}
          </button>
        ))}

        {!hasSearchText && (
          <button
            type="button"
            onClick={() => setShowOther((prev) => !prev)}
            className={`rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-all ${
              otherSelected
                ? "bg-primary/10 border border-primary text-primary"
                : "bg-surface-2 border border-dashed border-border-subtle text-muted-foreground"
            }`}
          >
            その他{showOther ? " ▴" : "..."}
          </button>
        )}
      </div>

      {(showOther || hasSearchText) && (
        <div className="mt-3">
          <div className="flex items-center gap-2 bg-surface-2 rounded-lg border border-border-subtle px-3 py-2 mb-3">
            <Search size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
            <input
              type="text"
              placeholder="デッキ名を検索・入力..."
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                if (e.target.value.trim()) {
                  onChange(e.target.value);
                }
              }}
              className="flex-1 bg-transparent border-none outline-none text-foreground text-[13px]"
              autoFocus
            />
            {searchText && (
              <button
                type="button"
                onClick={() => {
                  setSearchText("");
                  onChange("");
                }}
                aria-label="検索をクリア"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {noMatch ? (
            <p className="text-[11px] text-muted-foreground text-center py-2">
              該当するデッキがありません。入力テキストがそのまま使用されます。
            </p>
          ) : (
            <>
              {(hasSearchText ? filteredMinor : minorSuggestions).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(hasSearchText ? filteredMinor : minorSuggestions).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleSelect(name)}
                      className={chipClass(name)}
                    >
                      {display(name)}
                    </button>
                  ))}
                </div>
              )}

              {!hasSearchText && otherSuggestions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowMore((prev) => !prev)}
                  className="mt-2 rounded-lg px-3.5 py-1.5 text-[11px] font-medium transition-all bg-surface-2 border border-dashed border-border-subtle text-muted-foreground"
                >
                  さらに表示{showMore ? " ▴" : "..."}
                </button>
              )}

              {(hasSearchText || showMore) && (hasSearchText ? filteredOther : otherSuggestions).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(hasSearchText ? filteredOther : otherSuggestions).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleSelect(name)}
                      className={chipClass(name)}
                    >
                      {display(name)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
