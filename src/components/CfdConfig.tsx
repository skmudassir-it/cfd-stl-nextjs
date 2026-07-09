"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Loader2 } from "lucide-react";
import type { FlowDirection } from "@/lib/types";

interface CfdConfigProps {
  onRun: (params: {
    flowDirection: FlowDirection;
    reynolds: number;
    gridNx: number;
    gridNy: number;
    tEnd: number;
    nFrames: number;
  }) => void;
  running: boolean;
  disabled: boolean;
}

export default function CfdConfig({ onRun, running, disabled }: CfdConfigProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    onRun({
      flowDirection: (fd.get("flow-dir") || "left_to_right") as FlowDirection,
      reynolds: Number(fd.get("reynolds")) || 100,
      gridNx: Number(fd.get("grid-nx")) || 200,
      gridNy: Number(fd.get("grid-ny")) || 100,
      tEnd: Number(fd.get("t-end")) || 15,
      nFrames: Number(fd.get("n-frames")) || 120,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="flow-dir" className="text-xs text-zinc-400">
            Flow Direction
          </Label>
          <Select name="flow-dir" defaultValue="left_to_right" disabled={disabled || running}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-sm h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              <SelectItem value="left_to_right">Left → Right</SelectItem>
              <SelectItem value="right_to_left">Right → Left</SelectItem>
              <SelectItem value="bottom_to_top">Bottom → Top</SelectItem>
              <SelectItem value="top_to_bottom">Top → Bottom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reynolds" className="text-xs text-zinc-400">
            Reynolds Number
          </Label>
          <Input
            id="reynolds"
            name="reynolds"
            type="number"
            defaultValue={100}
            min={10}
            max={600}
            step={10}
            disabled={disabled || running}
            className="bg-zinc-900 border-zinc-700 h-9 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="grid-nx" className="text-xs text-zinc-400">
            Grid Points (X)
          </Label>
          <Input
            id="grid-nx"
            name="grid-nx"
            type="number"
            defaultValue={200}
            min={40}
            max={400}
            step={20}
            disabled={disabled || running}
            className="bg-zinc-900 border-zinc-700 h-9 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="grid-ny" className="text-xs text-zinc-400">
            Grid Points (Y)
          </Label>
          <Input
            id="grid-ny"
            name="grid-ny"
            type="number"
            defaultValue={100}
            min={20}
            max={200}
            step={10}
            disabled={disabled || running}
            className="bg-zinc-900 border-zinc-700 h-9 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="t-end" className="text-xs text-zinc-400">
            Sim Time (s)
          </Label>
          <Input
            id="t-end"
            name="t-end"
            type="number"
            defaultValue={15}
            min={5}
            max={40}
            step={5}
            disabled={disabled || running}
            className="bg-zinc-900 border-zinc-700 h-9 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="n-frames" className="text-xs text-zinc-400">
            Animation Frames
          </Label>
          <Input
            id="n-frames"
            name="n-frames"
            type="number"
            defaultValue={120}
            min={40}
            max={200}
            step={10}
            disabled={disabled || running}
            className="bg-zinc-900 border-zinc-700 h-9 text-sm"
          />
        </div>
      </div>

      <Button
        type="submit"
        disabled={disabled || running}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white h-10"
      >
        {running ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Running CFD Simulation...
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" />
            Run Simulation
          </>
        )}
      </Button>
    </form>
  );
}
