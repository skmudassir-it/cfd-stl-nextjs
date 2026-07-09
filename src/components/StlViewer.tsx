"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";
import type { PlaneAxis } from "@/lib/types";

function StlMesh({
  url,
  onBounds,
}: {
  url: string;
  onBounds?: (box: THREE.Box3) => void;
}) {
  const geometry = useLoader(STLLoader, url);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (geometry && onBounds) {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      // center the geometry
      const cx = (box.min.x + box.max.x) / 2;
      const cy = (box.min.y + box.max.y) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      geometry.translate(-cx, -cy, -cz);
      geometry.computeBoundingBox();
      onBounds(geometry.boundingBox!);
    }
  }, [geometry, onBounds]);

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshPhongMaterial
        color="#8b5cf6"
        specular="#444466"
        shininess={40}
        transparent
        opacity={0.88}
      />
    </mesh>
  );
}

function SlicePlane({
  axis,
  position,
  visible,
}: {
  axis: PlaneAxis;
  position: number;
  visible: boolean;
}) {
  if (!visible) return null;

  const size = 10;
  let rotation: [number, number, number] = [0, 0, 0];
  let pos: [number, number, number] = [0, 0, 0];

  if (axis === "z") {
    pos = [0, 0, position];
  } else if (axis === "y") {
    rotation = [-Math.PI / 2, 0, 0];
    pos = [0, position, 0];
  } else {
    rotation = [0, Math.PI / 2, 0];
    pos = [position, 0, 0];
  }

  return (
    <mesh position={pos} rotation={rotation}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial
        color="#ef4444"
        side={THREE.DoubleSide}
        transparent
        opacity={0.3}
      />
    </mesh>
  );
}

function SceneSetup({ hasModel }: { hasModel: boolean }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!hasModel) {
      camera.position.set(3, 2, 5);
      camera.lookAt(0, 0, 0);
    }
  }, [camera, hasModel]);
  return null;
}

export default function StlViewer({
  stlUrl,
  sliceAxis,
  slicePosition,
  showPlane,
  onBoundsReady,
}: {
  stlUrl: string | null;
  sliceAxis: PlaneAxis;
  slicePosition: number;
  showPlane: boolean;
  onBoundsReady?: (box: THREE.Box3) => void;
}) {
  return (
    <div className="w-full h-full bg-[#0a0a0f] rounded-xl overflow-hidden border border-zinc-800">
      <Canvas
        camera={{ position: [3, 2, 5], fov: 45 }}
        gl={{ antialias: true }}
      >
        <ambientLight intensity={2} color="#404060" />
        <directionalLight position={[5, 10, 5]} intensity={1.5} />
        <directionalLight position={[-5, -2, -5]} intensity={0.8} color="#8888ff" />
        <Grid
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#27272a"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#18181b"
          fadeDistance={50}
          infiniteGrid
        />
        <SceneSetup hasModel={!!stlUrl} />
        <OrbitControls enableDamping dampingFactor={0.08} />
        {stlUrl && <StlMesh url={stlUrl} onBounds={onBoundsReady} />}
        {stlUrl && (
          <SlicePlane
            axis={sliceAxis}
            position={slicePosition}
            visible={showPlane}
          />
        )}
      </Canvas>
    </div>
  );
}
