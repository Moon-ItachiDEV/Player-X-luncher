// Dans ce build, cette page ne sert qu'à l'overlay CS2 (main/services/cs2Overlay.ts) : la fenêtre principale charge la V3
// (renderer/v3/index.html). JS sans framework.
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './overlay/overlay.css'
import { startOverlay } from './overlay/overlay'

document.documentElement.classList.add('ov-page')
startOverlay(document.getElementById('root')!)
