import { LevaPanel, button, folder, useControls, useCreateStore } from 'leva';
import { useMemo, useRef, useState } from 'react';
import { BOTS, CAMERA, PHYSICS, TABLE, TUNING } from '../constants.js';
import {
  debugRuntime,
  exportDebugTuning,
  getDebugTuningDefaults,
  importDebugTuning,
  resetDebugTuning,
  setDebugTuningValue,
} from '../debug-tuning.js';
import { debugFlags, useGameStore } from '../store.js';

const roots = {
  runtime: debugRuntime,
  table: TABLE,
  physics: PHYSICS,
  camera: CAMERA,
  tuning: TUNING,
  bots: Object.fromEntries(BOTS.map((bot) => [bot.id, bot])),
};

function getPath(path) {
  return path.split('.').reduce((value, key) => value?.[key], roots);
}

function DebugControls({ remount, store }) {
  const structuralTimer = useRef(null);

  const bumpStructural = () => {
    clearTimeout(structuralTimer.current);
    structuralTimer.current = setTimeout(() => {
      useGameStore.getState().bumpDebugRevision();
    }, 120);
  };

  const control = (path, options = {}, structural = false) => ({
    value: getPath(path),
    ...options,
    onChange: (value) => {
      setDebugTuningValue(path, value);
      if (structural) bumpStructural();
    },
  });

  const copyExport = async () => {
    const json = exportDebugTuning();
    console.info('[debug tuning export]', json);
    try {
      await navigator.clipboard?.writeText(json);
    } catch {
      // Console output is fallback.
    }
  };

  const importFromPrompt = () => {
    const json = window.prompt('Paste debug tuning JSON');
    if (!json) return;
    try {
      importDebugTuning(json);
      useGameStore.getState().bumpDebugRevision();
      remount();
    } catch (error) {
      console.warn('[debug tuning] import failed', error);
      window.alert('Invalid tuning JSON. See console for details.');
    }
  };

  const reset = () => {
    resetDebugTuning();
    const defaults = getDebugTuningDefaults();
    store.set({
      'Runtime.TimeScale': defaults.runtime.timeScale,
      'Physics.TableHalfLength': defaults.table.halfLength,
      'Physics.TableHalfWidth': defaults.table.halfWidth,
      'Physics.NetHeight': defaults.table.netHeight,
      'Physics.BallRadius': defaults.table.ballRadius,
      'Physics.Bounce': defaults.table.bounceRestitution,
      'Physics.Gravity': defaults.physics.gravity,
      'Physics.Magnus': defaults.physics.magnus,
      'Physics.SpeedScale': defaults.physics.speedScale,
      'Physics.CurveScale': defaults.physics.curveScale,
      'Physics.HitReach': defaults.physics.hitReach,
      'Physics.PlayerReach': defaults.physics.playerReach,
      'Physics.ServeHeight': defaults.physics.serveHeight,
      'Physics.PaddleThickness': defaults.physics.paddleThickness,
      'Physics.PlayerHeight': defaults.physics.playerHeight,
      'Physics.SpinDecay': defaults.physics.spinDecay,
      'Camera.IntroX': defaults.camera.introPosition[0],
      'Camera.IntroY': defaults.camera.introPosition[1],
      'Camera.IntroZ': defaults.camera.introPosition[2],
      'Camera.IntroTargetY': defaults.camera.introTarget[1],
      'Camera.PlayX': defaults.camera.playPosition[0],
      'Camera.PlayY': defaults.camera.playPosition[1],
      'Camera.PlayZ': defaults.camera.playPosition[2],
      'Camera.DesktopY': defaults.camera.desktopPosition[1],
      'Camera.DesktopZ': defaults.camera.desktopPosition[2],
      'Camera.MenuDolly': defaults.camera.menuDolly,
      'Camera.CameraLag': defaults.camera.cameraLag,
      'WorldTable.Background': defaults.tuning.world.background,
      'WorldTable.Fog': defaults.tuning.world.fog,
      'WorldTable.FogDensity': defaults.tuning.world.fogDensity,
      'WorldTable.LineColor': defaults.tuning.table.lineColor,
      'WorldTable.TableEmissive': defaults.tuning.table.emissive,
      'WorldTable.TableHot': defaults.tuning.table.hot,
      'WorldTable.BaseGlow': defaults.tuning.table.baseGlow,
      'WorldTable.HeatGlow': defaults.tuning.table.heatGlow,
      'WorldTable.FlashGlow': defaults.tuning.table.flashGlow,
      'WorldTable.LineGlow': defaults.tuning.table.lineGlow,
      'WorldTable.RingColor': defaults.tuning.background.ringColor,
      'WorldTable.RingInner': defaults.tuning.background.ringInner,
      'WorldTable.RingWidth': defaults.tuning.background.ringWidth,
      'WorldTable.RingOpacity': defaults.tuning.background.ringOpacity,
      'LightingPost.SkyZenith': defaults.tuning.sky.zenith,
      'LightingPost.SkyEdge': defaults.tuning.sky.edge,
      'LightingPost.SkyHorizon': defaults.tuning.sky.horizon,
      'LightingPost.Ambient': defaults.tuning.lighting.ambient,
      'LightingPost.AmbientColor': defaults.tuning.lighting.ambColor,
      'LightingPost.Key': defaults.tuning.lighting.key,
      'LightingPost.KeyColor': defaults.tuning.lighting.keyColor,
      'LightingPost.Bloom': defaults.tuning.post.bloom,
      'LightingPost.BloomHeat': defaults.tuning.post.bloomHeat,
      'LightingPost.BloomFlash': defaults.tuning.post.bloomFlash,
      'LightingPost.Threshold': defaults.tuning.post.luminanceThreshold,
      'LightingPost.Smoothing': defaults.tuning.post.luminanceSmoothing,
      'LightingPost.Radius': defaults.tuning.post.bloomRadius,
      'LightingPost.Levels': defaults.tuning.post.bloomLevels,
      'NetTrail.NetColor': defaults.tuning.net.color,
      'NetTrail.NetOpacity': defaults.tuning.net.opacity,
      'NetTrail.TrailWidth': defaults.tuning.ballTrail.width,
      'NetTrail.TrailLength': defaults.tuning.ballTrail.length,
      'NetTrail.TrailDecay': defaults.tuning.ballTrail.decay,
      'NetTrail.TrailColor': defaults.tuning.ballTrail.color,
      'NetTrail.Attenuation': defaults.tuning.ballTrail.attenuationPower,
      'MenuScoreboard.TitleColor': defaults.tuning.menu.titleColor,
      'MenuScoreboard.TitleBoost': defaults.tuning.menu.titleBoost,
      'MenuScoreboard.TitleGlow': defaults.tuning.menu.titleGlow,
      'MenuScoreboard.TitleSize': defaults.tuning.menu.titleSize,
      'MenuScoreboard.GlassOpacity': defaults.tuning.menu.glassOpacity,
      'MenuScoreboard.ScoreFill': defaults.tuning.scoreboard.scoreFill,
      'MenuScoreboard.ScoreBoost': defaults.tuning.scoreboard.scoreFillBoost,
      'MenuScoreboard.ScoreSize': defaults.tuning.scoreboard.scoreFontSize,
      'MenuScoreboard.ScoreX': defaults.tuning.scoreboard.scoreX,
      'MenuScoreboard.ScoreY': defaults.tuning.scoreboard.boardCY,
      'MenuScoreboard.LabelSize': defaults.tuning.scoreboard.labelFontSize,
      'MenuScoreboard.ServeDotColor': defaults.tuning.scoreboard.serveDotColor,
      'MenuScoreboard.PopScale': defaults.tuning.scoreboard.popScale,
      ...Object.fromEntries(Object.entries(defaults.bots).flatMap(([id, bot]) => {
        const prefix = `${id[0].toUpperCase()}${id.slice(1)}`;
        return [
          [`AI.${prefix}.${prefix}Skill`, bot.skill],
          [`AI.${prefix}.${prefix}Speed`, bot.paddleSpeed],
          [`AI.${prefix}.${prefix}React`, bot.react],
          [`AI.${prefix}.${prefix}Delay`, bot.reactionDelay],
          [`AI.${prefix}.${prefix}Predict`, bot.predict],
          [`AI.${prefix}.${prefix}Error`, bot.error],
          [`AI.${prefix}.${prefix}Spin`, bot.spin],
          [`AI.${prefix}.${prefix}Aggression`, bot.aggression],
          [`AI.${prefix}.${prefix}Placement`, bot.placement],
          [`AI.${prefix}.${prefix}Smash`, bot.smashChance],
          [`AI.${prefix}.${prefix}ServeSpin`, bot.serveSpin],
        ];
      })),
    }, false);
    useGameStore.getState().bumpDebugRevision();
    remount();
  };

  const forceOver = (winner) => {
    const store = useGameStore.getState();
    if (!store.started) store.start();
    debugFlags.forceOver = { winner };
  };

  const newMatch = () => {
    const store = useGameStore.getState();
    if (store.started) store.newGame();
    else store.start();
  };

  const botFolder = (id, label) => {
    const prefix = label.replace(/\s+/g, '');
    return folder({
      [`${prefix}Skill`]: control(`bots.${id}.skill`, { label: 'Skill', min: 0.1, max: 1, step: 0.01 }),
      [`${prefix}Speed`]: control(`bots.${id}.paddleSpeed`, { label: 'Speed', min: 1, max: 24, step: 0.1 }),
      [`${prefix}React`]: control(`bots.${id}.react`, { label: 'React', min: 0, max: 16, step: 0.1 }),
      [`${prefix}Delay`]: control(`bots.${id}.reactionDelay`, { label: 'Delay', min: 0, max: 0.6, step: 0.01 }),
      [`${prefix}Predict`]: control(`bots.${id}.predict`, { label: 'Predict', min: 0, max: 1, step: 0.01 }),
      [`${prefix}Error`]: control(`bots.${id}.error`, { label: 'Error', min: 0, max: 0.35, step: 0.005 }),
      [`${prefix}Spin`]: control(`bots.${id}.spin`, { label: 'Spin', min: 0, max: 1.5, step: 0.01 }),
      [`${prefix}Aggression`]: control(`bots.${id}.aggression`, { label: 'Aggression', min: 0, max: 1.2, step: 0.01 }),
      [`${prefix}Placement`]: control(`bots.${id}.placement`, { label: 'Placement', min: 0, max: 1.2, step: 0.01 }),
      [`${prefix}Smash`]: control(`bots.${id}.smashChance`, { label: 'Smash', min: 0, max: 1, step: 0.01 }),
      [`${prefix}ServeSpin`]: control(`bots.${id}.serveSpin`, { label: 'ServeSpin', min: 0, max: 1.5, step: 0.01 }),
    }, { label, collapsed: true });
  };

  const schema = useMemo(() => ({
    Runtime: folder({
      TimeScale: control('runtime.timeScale', { min: 0, max: 2, step: 0.01 }),
      Pause: button(() => { setDebugTuningValue('runtime.timeScale', 0); remount(); }),
      NormalSpeed: button(() => { setDebugTuningValue('runtime.timeScale', 1); remount(); }),
      NewMatch: button(newMatch),
      ForceWin: button(() => forceOver('player')),
      ForceLoss: button(() => forceOver('ai')),
      ResetAll: button(reset),
      ExportJSON: button(copyExport),
      ImportJSON: button(importFromPrompt),
    }, { collapsed: false }),

    Physics: folder({
      TableHalfLength: control('table.halfLength', { min: 2, max: 8, step: 0.01 }, true),
      TableHalfWidth: control('table.halfWidth', { min: 1.5, max: 5, step: 0.01 }, true),
      NetHeight: control('table.netHeight', { min: 0.1, max: 1.4, step: 0.01 }, true),
      BallRadius: control('table.ballRadius', { min: 0.03, max: 0.25, step: 0.005 }, true),
      Bounce: control('table.bounceRestitution', { min: 0.1, max: 1.2, step: 0.01 }),
      Gravity: control('physics.gravity', { min: 1, max: 12, step: 0.1 }),
      Magnus: control('physics.magnus', { min: 0, max: 18, step: 0.1 }),
      SpeedScale: control('physics.speedScale', { min: 0, max: 4, step: 0.01 }),
      CurveScale: control('physics.curveScale', { min: 0, max: 4, step: 0.01 }),
      HitReach: control('physics.hitReach', { min: 0.1, max: 1.2, step: 0.01 }),
      PlayerReach: control('physics.playerReach', { min: 0.5, max: 4, step: 0.01 }),
      ServeHeight: control('physics.serveHeight', { min: 0.3, max: 2, step: 0.01 }),
      PaddleThickness: control('physics.paddleThickness', { min: 0.05, max: 0.8, step: 0.01 }),
      PlayerHeight: control('physics.playerHeight', { min: 0.5, max: 3, step: 0.01 }),
      SpinDecay: control('physics.spinDecay', { min: 0.1, max: 1.2, step: 0.01 }),
    }, { collapsed: true }),

    Camera: folder({
      IntroX: control('camera.introPosition.0', { min: -8, max: 8, step: 0.01 }),
      IntroY: control('camera.introPosition.1', { min: 0, max: 10, step: 0.01 }),
      IntroZ: control('camera.introPosition.2', { min: 4, max: 24, step: 0.01 }),
      IntroTargetY: control('camera.introTarget.1', { min: -4, max: 4, step: 0.01 }),
      PlayX: control('camera.playPosition.0', { min: -8, max: 8, step: 0.01 }),
      PlayY: control('camera.playPosition.1', { min: 0, max: 10, step: 0.01 }),
      PlayZ: control('camera.playPosition.2', { min: 4, max: 24, step: 0.01 }),
      DesktopY: control('camera.desktopPosition.1', { min: 0, max: 12, step: 0.01 }),
      DesktopZ: control('camera.desktopPosition.2', { min: 6, max: 28, step: 0.01 }),
      MenuDolly: control('camera.menuDolly', { min: 0.2, max: 4, step: 0.01 }),
      CameraLag: control('camera.cameraLag', { min: 0, max: 1, step: 0.01 }),
    }, { collapsed: true }),

    AI: folder({
      Rookie: botFolder('rookie', 'Rookie'),
      Pro: botFolder('pro', 'Pro'),
      Master: botFolder('master', 'Master'),
    }, { collapsed: true }),

    WorldTable: folder({
      Background: control('tuning.world.background'),
      Fog: control('tuning.world.fog'),
      FogDensity: control('tuning.world.fogDensity', { min: 0, max: 0.05, step: 0.0005 }),
      LineColor: control('tuning.table.lineColor'),
      TableEmissive: control('tuning.table.emissive'),
      TableHot: control('tuning.table.hot'),
      BaseGlow: control('tuning.table.baseGlow', { min: 0, max: 2, step: 0.01 }),
      HeatGlow: control('tuning.table.heatGlow', { min: 0, max: 2, step: 0.01 }),
      FlashGlow: control('tuning.table.flashGlow', { min: 0, max: 2, step: 0.01 }),
      LineGlow: control('tuning.table.lineGlow', { min: 0, max: 3, step: 0.01 }),
      RingColor: control('tuning.background.ringColor'),
      RingInner: control('tuning.background.ringInner', { min: 1, max: 12, step: 0.01 }, true),
      RingWidth: control('tuning.background.ringWidth', { min: 0.02, max: 1.5, step: 0.01 }, true),
      RingOpacity: control('tuning.background.ringOpacity', { min: 0, max: 1, step: 0.01 }),
    }, { collapsed: true }),

    LightingPost: folder({
      SkyZenith: control('tuning.sky.zenith'),
      SkyEdge: control('tuning.sky.edge'),
      SkyHorizon: control('tuning.sky.horizon', { min: 0, max: 1, step: 0.01 }),
      Ambient: control('tuning.lighting.ambient', { min: 0, max: 6, step: 0.01 }),
      AmbientColor: control('tuning.lighting.ambColor'),
      Key: control('tuning.lighting.key', { min: 0, max: 12, step: 0.01 }),
      KeyColor: control('tuning.lighting.keyColor'),
      Bloom: control('tuning.post.bloom', { min: 0, max: 3, step: 0.01 }),
      BloomHeat: control('tuning.post.bloomHeat', { min: 0, max: 1, step: 0.01 }),
      BloomFlash: control('tuning.post.bloomFlash', { min: 0, max: 1, step: 0.01 }),
      Threshold: control('tuning.post.luminanceThreshold', { min: 0, max: 1.5, step: 0.01 }),
      Smoothing: control('tuning.post.luminanceSmoothing', { min: 0, max: 1, step: 0.01 }),
      Radius: control('tuning.post.bloomRadius', { min: 0, max: 1, step: 0.01 }),
      Levels: control('tuning.post.bloomLevels', { min: 1, max: 8, step: 1 }),
    }, { collapsed: true }),

    NetTrail: folder({
      NetColor: control('tuning.net.color'),
      NetOpacity: control('tuning.net.opacity', { min: 0, max: 1, step: 0.01 }),
      TrailWidth: control('tuning.ballTrail.width', { min: 0.5, max: 12, step: 0.1 }, true),
      TrailLength: control('tuning.ballTrail.length', { min: 1, max: 24, step: 1 }, true),
      TrailDecay: control('tuning.ballTrail.decay', { min: 0.5, max: 16, step: 0.1 }),
      TrailColor: control('tuning.ballTrail.color'),
      Attenuation: control('tuning.ballTrail.attenuationPower', { min: 0.2, max: 8, step: 0.1 }),
    }, { collapsed: true }),

    MenuScoreboard: folder({
      TitleColor: control('tuning.menu.titleColor'),
      TitleBoost: control('tuning.menu.titleBoost', { min: 0.2, max: 4, step: 0.01 }),
      TitleGlow: control('tuning.menu.titleGlow', { min: 0, max: 2, step: 0.01 }),
      TitleSize: control('tuning.menu.titleSize', { min: 1, max: 6, step: 0.01 }),
      GlassOpacity: control('tuning.menu.glassOpacity', { min: 0, max: 1, step: 0.01 }),
      ScoreFill: control('tuning.scoreboard.scoreFill'),
      ScoreBoost: control('tuning.scoreboard.scoreFillBoost', { min: 0.2, max: 4, step: 0.01 }),
      ScoreSize: control('tuning.scoreboard.scoreFontSize', { min: 1, max: 8, step: 0.01 }),
      ScoreX: control('tuning.scoreboard.scoreX', { min: 1, max: 8, step: 0.01 }),
      ScoreY: control('tuning.scoreboard.boardCY', { min: 0, max: 1, step: 0.01 }),
      LabelSize: control('tuning.scoreboard.labelFontSize', { min: 0.1, max: 1, step: 0.01 }),
      ServeDotColor: control('tuning.scoreboard.serveDotColor'),
      PopScale: control('tuning.scoreboard.popScale', { min: 0, max: 0.6, step: 0.01 }),
    }, { collapsed: true }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useControls(schema, { store });
  return null;
}

function DebugPanelInner({ remount }) {
  const store = useCreateStore();

  return (
    <>
      <DebugControls remount={remount} store={store} />
      <LevaPanel store={store} collapsed={false} oneLineLabels />
    </>
  );
}

export default function DebugPanel() {
  const [revision, setRevision] = useState(0);
  const remount = () => setRevision((value) => value + 1);

  return <DebugPanelInner key={revision} remount={remount} />;
}
