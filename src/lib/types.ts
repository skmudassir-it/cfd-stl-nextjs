// Types for the CFD-STL application

export interface StlBounds {
  bounds: [[number, number, number], [number, number, number]];
  centroid: [number, number, number];
  extent: [number, number, number];
  session_id: string;
}

export type SlicePoint = [number, number];

export interface SliceResult {
  axis: string;
  position: number;
  bounds_range: [number, number];
  polygons: SlicePoint[][];
  num_polygons: number;
}

export interface CfdParams {
  polygons: SlicePoint[][];
  flow_direction: string;
  reynolds: number;
  grid_nx: number;
  grid_ny: number;
  t_end: number;
  n_frames: number;
}

export interface CfdResult {
  success: boolean;
  result_url: string;
  params: {
    reynolds: number;
    flow_direction: string;
    grid: string;
    t_end: number;
  };
}

export type PlaneAxis = "x" | "y" | "z";
export type FlowDirection =
  | "left_to_right"
  | "right_to_left"
  | "bottom_to_top"
  | "top_to_bottom";

// App state machine
export type AppStep = "upload" | "slice" | "configure" | "simulating" | "done";
