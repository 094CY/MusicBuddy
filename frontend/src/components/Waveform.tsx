import { useEffect, useRef } from 'react';

interface WaveformProps {
  isPlaying: boolean;
  className?: string;
}

export default function Waveform({ isPlaying, className = '' }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const bars = 64;
    const barGap = 2;
    const barWidth = (rect.width - (bars - 1) * barGap) / bars;

    const draw = (time: number) => {
      ctx.clearRect(0, 0, rect.width, rect.height);
      const centerY = rect.height / 2;

      for (let i = 0; i < bars; i++) {
        let height: number;

        if (isPlaying) {
          const t = time * 0.002;
          const freq1 = Math.sin(t + i * 0.2) * 0.5 + 0.5;
          const freq2 = Math.sin(t * 1.5 + i * 0.12 + 1) * 0.5 + 0.5;
          const freq3 = Math.sin(t * 0.7 + i * 0.08 + 2) * 0.5 + 0.5;
          const combined = freq1 * 0.5 + freq2 * 0.3 + freq3 * 0.2;
          height = combined * rect.height * 0.9 + 3;
        } else {
          height = 3;
        }

        const x = i * (barWidth + barGap);
        const y = centerY - height / 2;

        if (isPlaying) {
          const gradient = ctx.createLinearGradient(0, y, 0, y + height);
          gradient.addColorStop(0, 'rgba(201, 169, 110, 0.15)');
          gradient.addColorStop(0.5, 'rgba(201, 169, 110, 0.7)');
          gradient.addColorStop(1, 'rgba(201, 169, 110, 0.15)');
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        }

        const r = Math.min(barWidth / 2, 2);
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, height, r);
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${className}`}
      style={{ height: '64px' }}
    />
  );
}
