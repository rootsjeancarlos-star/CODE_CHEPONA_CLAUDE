import * as THREE from 'three/webgpu'
import { pass, renderOutput } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'

/**
 * Post-procesado con THREE.RenderPipeline (r186). Modos:
 *  - 'none': render directo (sin pipeline)
 *  - 'fxaa': tone mapping + FXAA
 *  - 'bloom': bloom suave + FXAA
 *  - 'full': bloom + SMAA
 * El tone mapping y la conversión a sRGB se aplican con renderOutput() antes del antialiasing.
 */
export function createPostFX(rendererManager, scene, camera, mode) {
  if (!mode || mode === 'none') return null
  const pipeline = new THREE.RenderPipeline(rendererManager.renderer)
  const scenePass = pass(scene, camera)
  let color = scenePass.getTextureNode('output')
  if (mode === 'bloom' || mode === 'full') {
    const b = bloom(color, mode === 'full' ? 0.32 : 0.22, 0.45, 0.88)
    color = color.add(b)
  }
  let out = renderOutput(color)
  out = mode === 'full' ? smaa(out) : fxaa(out)
  pipeline.outputColorTransform = false
  pipeline.outputNode = out
  return pipeline
}
