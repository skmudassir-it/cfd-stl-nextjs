"use client";

import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ExternalLink } from "lucide-react";
import type { CfdResult } from "@/lib/types";
import { resultUrl } from "@/lib/api";

export default function ResultsView({ result }: { result: CfdResult }) {
  const fullUrl = resultUrl(result.result_url);

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-sm font-medium">Simulation Complete</span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
          <span>
            Re = <span className="text-zinc-200">{result.params.reynolds}</span>
          </span>
          <span>
            Flow:{" "}
            <span className="text-zinc-200">
              {result.params.flow_direction.replace(/_/g, " ")}
            </span>
          </span>
          <span>
            Grid:{" "}
            <span className="text-zinc-200">{result.params.grid}</span>
          </span>
          <span>
            t = <span className="text-zinc-200">{result.params.t_end}s</span>
          </span>
        </div>

        <a
          href={fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <div className="relative rounded-lg overflow-hidden border border-zinc-700 hover:border-violet-500 transition-colors group">
            <img
              src={fullUrl}
              alt="CFD simulation result"
              className="w-full"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <ExternalLink className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </a>
      </CardContent>
    </Card>
  );
}
