import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { DEFAULT_PROMO_VIDEO_PROPS, PromoVideoComposition, type PromoVideoProps } from './PromoVideo';

function RemotionRoot() {
  return (
    <Composition
      id="PromoVideo"
      component={PromoVideoComposition}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={900}
      defaultProps={DEFAULT_PROMO_VIDEO_PROPS}
      calculateMetadata={({ props }: { props: PromoVideoProps }) => ({
        fps: props.fps || 30,
        width: props.width || 1080,
        height: props.height || 1920,
        durationInFrames: props.durationInFrames || 900,
      })}
    />
  );
}

registerRoot(RemotionRoot);
