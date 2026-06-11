// Recovered postprocessing from production bundle function `Pj`.

import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { ToneMappingMode } from 'postprocessing';
import { TUNING } from '../constants.js';
import { arenaFx, clampDt, damp } from '../fx-state.js';

export function Postprocessing() {
  const bloom = useRef(null);

  useFrame((_, delta) => {
    const dt = clampDt(delta);
    const { heat, pulse, smash, score } = arenaFx;
    const flash = Math.max(pulse * 0.5, smash, score * 0.7);
    const config = TUNING.post;
    const effect = bloom.current;
    if (!effect) return;
    effect.intensity = damp(effect.intensity, config.bloom + heat * config.bloomHeat + flash * config.bloomFlash, 10, dt);
    if (effect.luminanceMaterial) {
      effect.luminanceMaterial.threshold = config.luminanceThreshold;
      effect.luminanceMaterial.smoothing = config.luminanceSmoothing;
    }
    if (effect.mipmapBlurPass) {
      effect.mipmapBlurPass.radius = config.bloomRadius;
      effect.mipmapBlurPass.levels = Math.round(config.bloomLevels);
    }
  });

  return (
    <EffectComposer multisampling={4} stencilBuffer={false}>
      <Bloom
        ref={bloom}
        mipmapBlur
        resolutionScale={1}
        intensity={TUNING.post.bloom}
        luminanceThreshold={TUNING.post.luminanceThreshold}
        luminanceSmoothing={TUNING.post.luminanceSmoothing}
        radius={TUNING.post.bloomRadius}
        levels={TUNING.post.bloomLevels}
      />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
}
