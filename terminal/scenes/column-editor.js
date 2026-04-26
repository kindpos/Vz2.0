import { SceneManager, defineScene } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import { buildStaticCard, buildPillButton, hexToRgba, darkenHex } from '../theme-manager.js';
import { showToast } from '../components.js';
import { entReport } from '../entomology-client.js';
import '../styles.js';

defineScene({
  name: 'column-editor',
  state: {},
  render: function(container, params, state) {},
  unmount: function(state) {},
});
