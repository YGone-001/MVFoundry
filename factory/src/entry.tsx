import {Composition, registerRoot} from 'remotion';
import {FactoryFilm, type FactoryFilmProps} from './remotion/FactoryFilm';
import {DEFAULT_RENDER_PROJECT} from './remotion/defaultProject';

const FactoryRoot: React.FC = () => (
  <Composition
    id="MV-Factory"
    component={FactoryFilm}
    defaultProps={{project: DEFAULT_RENDER_PROJECT} satisfies FactoryFilmProps}
    durationInFrames={DEFAULT_RENDER_PROJECT.output.durationInFrames}
    fps={DEFAULT_RENDER_PROJECT.output.fps}
    width={DEFAULT_RENDER_PROJECT.output.width}
    height={DEFAULT_RENDER_PROJECT.output.height}
    calculateMetadata={({props}) => ({
      durationInFrames: props.project.output.durationInFrames,
      fps: props.project.output.fps,
      width: props.project.output.width,
      height: props.project.output.height,
    })}
  />
);

registerRoot(FactoryRoot);
