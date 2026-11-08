import {Composition, registerRoot} from 'remotion';
import {ArtPlate, type ArtPlateProps} from './ArtPlate';

const ArtPlateRoot: React.FC = () => (
  <Composition
    id="ArtPlate"
    component={ArtPlate}
    defaultProps={{plate: 'cinematic-bg-street', width: 1920, height: 1080} satisfies ArtPlateProps}
    durationInFrames={1}
    fps={1}
    width={1920}
    height={1080}
    calculateMetadata={({props}) => ({
      durationInFrames: 1,
      fps: 1,
      width: props.width,
      height: props.height,
    })}
  />
);

registerRoot(ArtPlateRoot);
