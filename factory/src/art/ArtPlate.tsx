import {AbsoluteFill} from 'remotion';
import {useLayoutEffect, useRef} from 'react';
import {ART_PLATE_DRAWERS} from './plates';

export type ArtPlateProps = {
  plate: string;
  width: number;
  height: number;
};

/**
 * Renders one art plate into a canvas. Used only by the offline plate script;
 * it never participates in a project render.
 */
export const ArtPlate: React.FC<ArtPlateProps> = ({plate, width, height}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ArtPlate requires a 2D canvas context');
    const draw = ART_PLATE_DRAWERS[plate];
    if (!draw) throw new Error(`Unknown art plate: ${plate}`);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
  }, [plate, width, height]);
  return (
    <AbsoluteFill style={{background: 'transparent'}}>
      <canvas ref={ref} width={width} height={height} style={{width: '100%', height: '100%'}} />
    </AbsoluteFill>
  );
};
