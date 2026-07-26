"use client";

import { type AnalystResponse } from "@/src/lib/ai/analyst";

export function AnalystOutput({
  analysis,
  emptyText,
}: {
  analysis: AnalystResponse | null;
  emptyText: string;
}) {
  if (!analysis) {
    return (
      <div className="rounded-xl border border-dashed border-hood-border bg-hood-well/20 p-6 text-center text-sm text-hood-muted">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-hood-border bg-hood-well/40 p-3">
        <h3 className="text-xs font-semibold text-hood-muted">Summary</h3>
        <p className="mt-2 text-sm leading-6 text-hood-text">{analysis.summary}</p>
      </div>

      {analysis.sections.map((section) => (
        <div
          key={section.title}
          className="rounded-xl border border-hood-border bg-hood-panel p-3"
        >
          <h3 className="text-sm font-semibold text-hood-text">{section.title}</h3>
          <ul className="mt-2 space-y-2 text-sm leading-5 text-hood-muted">
            {section.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-hood-green" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {analysis.dataGaps.length > 0 && (
        <div className="rounded-xl border border-hood-amber/40 bg-hood-amberDim p-3">
          <h3 className="text-sm font-semibold text-hood-amber">Data gaps</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-hood-muted">
            {analysis.dataGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
