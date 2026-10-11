// STREETFLOW 3D — prueba de humo de WebGPURenderer (three 0.186.1).
// Ver docs/tech/THREE_WEBGPU_NOTES.md. Se sirve con Vite: /tools/smoke/smoke-webgpu.html
//
// Cubre: WebGPURenderer + init() + detección de backend, DirectionalLight con sombras
// (PCF/VSM/Basic o CSMShadowNode), MeshStandardMaterial con CanvasTexture, DataTexture,
// alphaTest, MeshStandardNodeMaterial (TSL), InstancedMesh dinámico, BatchedMesh, LOD,
// SkinnedMesh animado con AnimationMixer, SkyMesh + PMREM como scene.environment,
// Fog, tone mapping y RenderPipeline con bloom (+ FXAA/SMAA/TRAA/SSAO/GTAO opcionales).

import * as THREE from 'three/webgpu';
import { pass, mrt, output, velocity, normalView, screenUV, builtinAOContext, renderOutput, color, mix, sin, time } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { ssao } from 'three/addons/tsl/display/SSAONode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import WebGL from 'three/addons/capabilities/WebGL.js';

// ---------------------------------------------------------------------------
// Parámetros e informe
// ---------------------------------------------------------------------------

const qs = new URLSearchParams( location.search );
const P = {
	forceWebGL: qs.get( 'forceWebGL' ) === '1',
	post: qs.get( 'post' ) || 'bloom',
	aa: qs.get( 'aa' ) === '1',
	shadowType: qs.get( 'shadowType' ) || 'pcf',
	csm: qs.get( 'csm' ) === '1',
	tonemap: qs.get( 'tonemap' ) || 'aces',
	exposure: parseFloat( qs.get( 'exposure' ) || '0.32' ),
	instances: parseInt( qs.get( 'instances' ) || '1500', 10 ),
	frames: parseInt( qs.get( 'frames' ) || '90', 10 ),
	w: parseInt( qs.get( 'w' ) || '960', 10 ),
	h: parseInt( qs.get( 'h' ) || '540', 10 ),
	lose: qs.get( 'lose' ) === '1',
	noSwizzleShim: qs.get( 'noSwizzleShim' ) === '1',
	// offscreen=1: renderiza a un RenderTarget (sin presentar en el canvas) y al final vuelca los
	// píxeles a un <canvas> 2D. Necesario para WebGPU en Chromium headless sin GPU (ver notas).
	offscreen: qs.get( 'offscreen' ) === '1',
	// lista separada por comas de piezas a omitir (para aislar fallos):
	// sky,env,fog,hemi,sun,shadows,ground,ramp,fence,neon,orb,inst,batched,lod,skinned
	skip: new Set( ( qs.get( 'skip' ) || '' ).split( ',' ).filter( Boolean ) )
};

const R = window.__SMOKE__ = {
	status: 'loading',
	params: { ...P, skip: [ ...P.skip ] },
	errors: [],
	threeMessages: [],
	timings: {}
};

const hud = document.getElementById( 'hud' );
const setHud = ( text ) => { hud.textContent = text; };

window.addEventListener( 'error', ( e ) => R.errors.push( 'window.error: ' + ( e.message || e ) ) );
window.addEventListener( 'unhandledrejection', ( e ) => R.errors.push( 'unhandledrejection: ' + ( e.reason && e.reason.stack || e.reason ) ) );

// Interceptamos los log/warn/error internos de three (API real: THREE.setConsoleFunction).
THREE.setConsoleFunction( ( type, message, ...params ) => {

	R.threeMessages.push( `[${ type }] ${ message }` );
	( console[ type ] || console.log )( message, ...params );

} );

const nextFrame = () => new Promise( ( resolve ) => requestAnimationFrame( resolve ) );
const stats = ( arr ) => {

	if ( arr.length === 0 ) return null;
	const s = [ ...arr ].sort( ( a, b ) => a - b );
	const sum = s.reduce( ( a, b ) => a + b, 0 );
	const round = ( v ) => Math.round( v * 100 ) / 100;
	return { n: s.length, avg: round( sum / s.length ), median: round( s[ Math.floor( s.length / 2 ) ] ), p95: round( s[ Math.min( s.length - 1, Math.floor( s.length * 0.95 ) ) ] ), min: round( s[ 0 ] ), max: round( s[ s.length - 1 ] ) };

};

// ---------------------------------------------------------------------------
// Parche de compatibilidad: GPUTextureViewDescriptor.swizzle
// ---------------------------------------------------------------------------
// three r186 (src/renderers/webgpu/descriptors/GPUTextureViewDescriptor.js) pone SIEMPRE
// `swizzle = 'rgba'` (forma string del borrador actual de WebGPU). Chromium 141 expone una IDL
// anterior en la que `swizzle` es un diccionario GPUTextureComponentSwizzle {r,g,b,a}, y
// createView() lanza TypeError al primer render. 'rgba' es la identidad, así que quitarlo es
// semánticamente neutro. Se detecta con un dispositivo real y solo se parchea si hace falta.

function applySwizzleShimIfNeeded( device ) {

	if ( typeof GPUTexture === 'undefined' || ! device ) return 'no-webgpu';

	const probe = device.createTexture( { size: [ 1, 1 ], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING } );
	let needed = false;
	try {

		probe.createView( { swizzle: 'rgba' } );

	} catch ( e ) {

		needed = e instanceof TypeError;

	}

	probe.destroy();
	if ( ! needed ) return 'not-needed';

	const proto = GPUTexture.prototype;
	if ( proto.__sfSwizzleShim === true ) return 'applied';
	const createView = proto.createView;
	proto.createView = function ( descriptor ) {

		if ( descriptor && typeof descriptor.swizzle === 'string' ) {

			if ( descriptor.swizzle !== 'rgba' ) throw new Error( 'swizzle no identidad no soportado por este navegador: ' + descriptor.swizzle );
			const copy = Object.assign( {}, descriptor );
			delete copy.swizzle;
			return createView.call( this, copy );

		}

		return createView.call( this, descriptor );

	};

	proto.__sfSwizzleShim = true;
	return 'applied';

}

// ---------------------------------------------------------------------------
// Texturas generadas en CPU
// ---------------------------------------------------------------------------

function makeAsphaltCanvasTexture( renderer ) {

	const size = 512;
	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext( '2d' );

	ctx.fillStyle = '#3a3b3e';
	ctx.fillRect( 0, 0, size, size );

	// grano pseudoaleatorio determinista
	let seed = 1337;
	const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
	for ( let i = 0; i < 9000; i ++ ) {

		const g = 40 + Math.floor( rnd() * 50 );
		ctx.fillStyle = `rgb(${ g },${ g },${ g + 3 })`;
		ctx.fillRect( rnd() * size, rnd() * size, 2, 2 );

	}

	// línea pintada
	ctx.fillStyle = '#e8c547';
	ctx.fillRect( size / 2 - 6, 0, 12, size );

	const tex = new THREE.CanvasTexture( canvas );
	tex.colorSpace = THREE.SRGBColorSpace; // textura de color => sRGB
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set( 8, 8 );
	tex.anisotropy = Math.max( 1, Math.min( 8, renderer.getMaxAnisotropy() ) );
	return tex;

}

function makeFenceCanvasTexture() {

	const size = 128;
	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	ctx.clearRect( 0, 0, size, size );
	ctx.strokeStyle = 'rgba(190,195,200,1)';
	ctx.lineWidth = 6;
	ctx.beginPath();
	ctx.moveTo( 0, 0 ); ctx.lineTo( size, size );
	ctx.moveTo( size, 0 ); ctx.lineTo( 0, size );
	ctx.stroke();

	const tex = new THREE.CanvasTexture( canvas );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set( 10, 3 );
	return tex;

}

function makeCheckerDataTexture() {

	const s = 4;
	const data = new Uint8Array( s * s * 4 );
	for ( let y = 0; y < s; y ++ ) for ( let x = 0; x < s; x ++ ) {

		const i = ( y * s + x ) * 4;
		const on = ( x + y ) % 2 === 0;
		data[ i ] = data[ i + 1 ] = data[ i + 2 ] = on ? 255 : 170;
		data[ i + 3 ] = 255;

	}

	// RGBAFormat + UnsignedByteType: válido en ambos backends (RGBFormat+UnsignedByte NO existe en WebGPU)
	const tex = new THREE.DataTexture( data, s, s, THREE.RGBAFormat, THREE.UnsignedByteType );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.magFilter = THREE.NearestFilter;
	tex.needsUpdate = true;
	return tex;

}

// ---------------------------------------------------------------------------
// SkinnedMesh procedural (tubo con 5 huesos) + clip de animación
// ---------------------------------------------------------------------------

function createSkinnedTube() {

	const segmentHeight = 0.7;
	const segmentCount = 4;
	const height = segmentHeight * segmentCount;
	const halfHeight = height / 2;

	const geometry = new THREE.CylinderGeometry( 0.22, 0.35, height, 16, segmentCount * 4, false );
	const position = geometry.attributes.position;
	const v = new THREE.Vector3();
	const skinIndices = [];
	const skinWeights = [];

	for ( let i = 0; i < position.count; i ++ ) {

		v.fromBufferAttribute( position, i );
		const y = v.y + halfHeight;
		const skinIndex = Math.min( Math.floor( y / segmentHeight ), segmentCount - 1 );
		const skinWeight = ( y - skinIndex * segmentHeight ) / segmentHeight;
		skinIndices.push( skinIndex, skinIndex + 1, 0, 0 );
		skinWeights.push( 1 - skinWeight, skinWeight, 0, 0 );

	}

	geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( skinIndices, 4 ) );
	geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( skinWeights, 4 ) );

	const bones = [];
	let prev = new THREE.Bone();
	prev.name = 'bone0';
	prev.position.y = - halfHeight;
	bones.push( prev );

	for ( let i = 1; i <= segmentCount; i ++ ) {

		const bone = new THREE.Bone();
		bone.name = 'bone' + i;
		bone.position.y = segmentHeight;
		prev.add( bone );
		bones.push( bone );
		prev = bone;

	}

	const material = new THREE.MeshStandardMaterial( { color: 0xff7a1a, roughness: 0.45, metalness: 0.0 } );
	const mesh = new THREE.SkinnedMesh( geometry, material );
	mesh.add( bones[ 0 ] );
	mesh.bind( new THREE.Skeleton( bones ) );
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	// El boundingSphere de un SkinnedMesh se calcula una vez (pose actual) y no se
	// actualiza solo: para mallas animadas, o se recalcula o se desactiva el culling.
	mesh.frustumCulled = false;

	const axis = new THREE.Vector3( 0, 0, 1 );
	const qa = new THREE.Quaternion().setFromAxisAngle( axis, 0.32 ).toArray();
	const qb = new THREE.Quaternion().setFromAxisAngle( axis, - 0.32 ).toArray();
	const tracks = [];
	for ( let i = 1; i <= segmentCount; i ++ ) {

		tracks.push( new THREE.QuaternionKeyframeTrack( `bone${ i }.quaternion`, [ 0, 1, 2 ], [ ...qa, ...qb, ...qa ] ) );

	}

	const clip = new THREE.AnimationClip( 'sway', 2, tracks );
	const mixer = new THREE.AnimationMixer( mesh );
	mixer.clipAction( clip ).play();

	return { mesh, mixer };

}

// ---------------------------------------------------------------------------
// Post-procesado
// ---------------------------------------------------------------------------

// El umbral del bloom se compara con el color HDR lineal ANTES de la exposición/tone mapping.
// SkyMesh produce radiancias de varias unidades: con umbral < ~5 todo el cielo "florece".
const BLOOM_THRESHOLD = 6;

function buildPipeline( renderer, scene, camera, mode ) {

	const pipeline = new THREE.RenderPipeline( renderer );
	const info = { mode };

	if ( mode === 'none' ) {

		pipeline.outputNode = pass( scene, camera );
		return { pipeline, info };

	}

	if ( mode === 'bloom' ) {

		const scenePass = pass( scene, camera );
		const sceneColor = scenePass.getTextureNode( 'output' );
		const bloomPass = bloom( sceneColor, 0.8, 0.3, BLOOM_THRESHOLD ); // (input, strength, radius, threshold)
		pipeline.outputNode = sceneColor.add( bloomPass );
		info.bloom = bloomPass;
		return { pipeline, info };

	}

	if ( mode === 'bloom-fxaa' ) {

		// FXAA necesita entrada sRGB ya tonemapeada: desactivar la transformación automática
		pipeline.outputColorTransform = false;
		const scenePass = pass( scene, camera );
		const sceneColor = scenePass.getTextureNode( 'output' );
		const withBloom = sceneColor.add( bloom( sceneColor, 0.8, 0.3, BLOOM_THRESHOLD ) );
		pipeline.outputNode = fxaa( renderOutput( withBloom ) );
		return { pipeline, info };

	}

	if ( mode === 'bloom-smaa' ) {

		// SMAA se aplica ANTES de la conversión a sRGB (la hace RenderPipeline)
		const scenePass = pass( scene, camera );
		const sceneColor = scenePass.getTextureNode( 'output' );
		pipeline.outputNode = smaa( sceneColor.add( bloom( sceneColor, 0.8, 0.3, BLOOM_THRESHOLD ) ) );
		return { pipeline, info };

	}

	if ( mode === 'bloom-traa' ) {

		// TRAA: requiere MSAA desactivado y velocidad en MRT
		const scenePass = pass( scene, camera, { samples: 0 } );
		scenePass.setMRT( mrt( { output, velocity } ) );
		const sceneColor = scenePass.getTextureNode( 'output' );
		const traaPass = traa( sceneColor, scenePass.getTextureNode( 'depth' ), scenePass.getTextureNode( 'velocity' ), camera );
		pipeline.outputNode = traaPass.add( bloom( traaPass, 0.8, 0.3, BLOOM_THRESHOLD ) );
		return { pipeline, info };

	}

	if ( mode === 'ssao-bloom' || mode === 'gtao-traa-bloom' ) {

		// Pre-pass de normales (+ velocidad para TRAA) y profundidad, como en webgpu_postprocessing_ao (r186)
		const prePass = pass( scene, camera, { samples: 0 } );
		prePass.transparent = false;
		const useGTAO = mode === 'gtao-traa-bloom';
		prePass.setMRT( mrt( useGTAO ? { output: normalView, velocity } : { output: normalView } ) );
		const prePassNormal = prePass.getTextureNode( 'output' );
		const prePassDepth = prePass.getTextureNode( 'depth' );

		const scenePass = pass( scene, camera, { samples: 0 } );
		const aoPass = useGTAO ? ao( prePassDepth, prePassNormal, camera ) : ssao( prePassDepth, prePassNormal, camera );
		aoPass.resolutionScale = 0.5;
		// el AO entra en el término ambiental/indirecto de los materiales
		scenePass.contextNode = builtinAOContext( aoPass.getTextureNode().sample( screenUV ).r );

		let color = scenePass.getTextureNode( 'output' );
		if ( useGTAO ) {

			color = traa( scenePass, prePassDepth, prePass.getTextureNode( 'velocity' ), camera );

		}

		pipeline.outputNode = color.add( bloom( color, 0.8, 0.3, BLOOM_THRESHOLD ) );
		return { pipeline, info };

	}

	throw new Error( 'post desconocido: ' + mode );

}

// ---------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------

async function main() {

	R.caps = {
		navigatorGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
		webgpuAdapter: WebGPU.isAvailable(), // hace requestAdapter() en top-level await
		webgl2: WebGL.isWebGL2Available()
	};

	const renderer = new THREE.WebGPURenderer( {
		antialias: P.aa,
		forceWebGL: P.forceWebGL,
		powerPreference: 'high-performance' // solo lo usa el backend WebGPU (requestAdapter)
	} );
	renderer.setPixelRatio( 1 ); // en juego: Math.min( devicePixelRatio, 2 )
	renderer.setSize( P.w, P.h );
	document.body.appendChild( renderer.domElement );

	renderer.onDeviceLost = ( info ) => {

		R.deviceLost = { api: info.api, message: info.message, reason: info.reason };
		R.errors.push( `deviceLost(${ info.api }): ${ info.message }` );
		renderer._isDeviceLost = true; // el manejador por defecto también lo marca; así render() deja de dibujar

	};

	const tInit = performance.now();
	try {

		await renderer.init();

	} catch ( e ) {

		R.status = 'no-backend';
		R.initError = String( e && e.message || e );
		setHud( 'Sin backend gráfico disponible:\n' + R.initError );
		return;

	}

	R.timings.initMs = Math.round( performance.now() - tInit );

	const backend = renderer.backend;
	R.backend = backend.isWebGPUBackend === true ? 'WebGPU' : ( backend.isWebGLBackend === true ? 'WebGL2' : 'desconocido' );
	R.coordinateSystem = renderer.coordinateSystem === THREE.WebGPUCoordinateSystem ? 'WebGPUCoordinateSystem' : 'WebGLCoordinateSystem';
	R.samples = renderer.samples;
	R.maxAnisotropy = renderer.getMaxAnisotropy();
	R.uniformBufferLimit = backend.capabilities.getUniformBufferLimit();

	if ( backend.isWebGPUBackend ) {

		R.swizzleShim = P.noSwizzleShim ? 'disabled-by-param' : applySwizzleShimIfNeeded( backend.device );
		R.compatibilityMode = backend.compatibilityMode;
		const ai = backend.device.adapterInfo;
		R.adapter = ai ? { vendor: ai.vendor, architecture: ai.architecture, device: ai.device, description: ai.description } : null;
		R.features = {
			timestampQuery: renderer.hasFeature( 'timestamp-query' ),
			bc: renderer.hasFeature( 'texture-compression-bc' ),
			etc2: renderer.hasFeature( 'texture-compression-etc2' ),
			astc: renderer.hasFeature( 'texture-compression-astc' ),
			float32Filterable: renderer.hasFeature( 'float32-filterable' )
		};

	} else if ( backend.isWebGLBackend ) {

		const gl = backend.gl;
		const ext = gl.getExtension( 'WEBGL_debug_renderer_info' );
		R.adapter = { renderer: ext ? gl.getParameter( ext.UNMASKED_RENDERER_WEBGL ) : gl.getParameter( gl.RENDERER ) };
		R.features = {
			bc: renderer.hasFeature( 'texture-compression-bc' ),
			etc2: renderer.hasFeature( 'texture-compression-etc2' ),
			astc: renderer.hasFeature( 'texture-compression-astc' ),
			s3tc: renderer.hasFeature( 'texture-compression-s3tc' ),
			timestampQuery: renderer.hasFeature( 'timestamp-query' )
		};

	}

	// --- render / color ----------------------------------------------------
	renderer.shadowMap.enabled = ! P.skip.has( 'shadows' );
	renderer.shadowMap.type = { pcf: THREE.PCFShadowMap, vsm: THREE.VSMShadowMap, basic: THREE.BasicShadowMap }[ P.shadowType ] ?? THREE.PCFShadowMap;
	renderer.toneMapping = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }[ P.tonemap ] ?? THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = P.exposure; // SkyMesh emite radiancia alta: exposición baja (0.1–0.5)
	// renderer.outputColorSpace = THREE.SRGBColorSpace; (valor por defecto)

	// --- escena ------------------------------------------------------------
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x8fa9c4 ); // visible solo si se omite el cielo
	if ( ! P.skip.has( 'fog' ) ) scene.fog = new THREE.Fog( 0x9fb4c8, 60, 260 ); // Fog/FogExp2 se convierten a nodos automáticamente
	const add = ( name, object ) => { if ( ! P.skip.has( name ) ) scene.add( object ); };

	const camera = new THREE.PerspectiveCamera( 55, P.w / P.h, 0.1, 2000 );
	camera.position.set( 13, 6.5, 17 );
	camera.lookAt( 0, 1.4, 0 );

	// Cielo + entorno PMREM generado desde el cielo
	const sky = new SkyMesh();
	sky.scale.setScalar( 1500 );
	sky.turbidity.value = 3.5;
	sky.rayleigh.value = 1.4;
	sky.mieCoefficient.value = 0.005;
	sky.mieDirectionalG.value = 0.8;
	sky.cloudCoverage.value = 0.35;
	const sunDir = new THREE.Vector3().setFromSphericalCoords( 1, THREE.MathUtils.degToRad( 90 - 38 ), THREE.MathUtils.degToRad( 135 ) );
	sky.sunPosition.value.copy( sunDir );

	if ( ! P.skip.has( 'env' ) ) {

		const tEnv = performance.now();
		const pmrem = new THREE.PMREMGenerator( renderer ); // la de 'three/webgpu', NO la de 'three'
		const envScene = new THREE.Scene();
		sky.showSunDisc.value = 0; // sin disco solar en el env map (evita "fireflies")
		envScene.add( sky );
		const envRT = pmrem.fromScene( envScene, 0, 0.1, 3000 );
		sky.showSunDisc.value = 1;
		scene.environment = envRT.texture;
		scene.environmentIntensity = 0.35;
		R.timings.pmremFromSceneMs = Math.round( performance.now() - tEnv );

	}

	add( 'sky', sky ); // un Object3D solo puede tener un padre: se mueve de envScene a scene

	// Luces
	const hemi = new THREE.HemisphereLight( 0xcfe3ff, 0x4a4036, 0.6 );
	add( 'hemi', hemi );

	const sun = new THREE.DirectionalLight( 0xfff1dd, 6.0 );
	sun.position.copy( sunDir ).multiplyScalar( 40 );
	sun.castShadow = true;
	sun.shadow.mapSize.set( 2048, 2048 );
	sun.shadow.bias = - 0.0005;
	sun.shadow.normalBias = 0.02;
	sun.shadow.radius = 3; // PCF: radio del disco Vogel (5 muestras)
	const sc = sun.shadow.camera;
	sc.left = - 22; sc.right = 22; sc.top = 22; sc.bottom = - 22; sc.near = 1; sc.far = 100;
	add( 'sun', sun );
	if ( ! P.skip.has( 'sun' ) ) scene.add( sun.target );

	if ( P.csm ) {

		const csm = new CSMShadowNode( sun, { cascades: 3, maxFar: 80, mode: 'practical', lightMargin: 30 } );
		csm.fade = true;
		sun.shadow.shadowNode = csm;
		R.csm = true;

	}

	// Suelo: MeshStandardMaterial + CanvasTexture
	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry( 120, 120 ),
		new THREE.MeshStandardMaterial( { map: makeAsphaltCanvasTexture( renderer ), roughness: 0.92, metalness: 0.0 } )
	);
	ground.rotation.x = - Math.PI / 2;
	ground.receiveShadow = true;
	add( 'ground', ground );

	// Rampa/bloque con MeshPhysicalMaterial (clearcoat)
	const ramp = new THREE.Mesh(
		new THREE.BoxGeometry( 4, 1.2, 3 ),
		new THREE.MeshPhysicalMaterial( { color: 0x6d7f95, roughness: 0.35, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2 } )
	);
	ramp.position.set( - 4, 0.6, - 2 );
	ramp.castShadow = ramp.receiveShadow = true;
	add( 'ramp', ramp );

	// Valla con alphaTest (sombra recortada por alpha)
	const fence = new THREE.Mesh(
		new THREE.PlaneGeometry( 16, 3 ),
		new THREE.MeshStandardMaterial( { map: makeFenceCanvasTexture(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 } )
	);
	fence.position.set( 0, 1.5, - 7 );
	fence.castShadow = fence.receiveShadow = true;
	add( 'fence', fence );

	// Letrero emisivo (HDR > 1 => bloom)
	const neon = new THREE.Mesh(
		new THREE.BoxGeometry( 3, 0.35, 0.15 ),
		new THREE.MeshStandardMaterial( { color: 0x000000, emissive: 0xff2a6d, emissiveIntensity: 40 } )
	);
	neon.position.set( 0, 3.4, - 6.9 );
	add( 'neon', neon );

	// Material de nodos TSL (MeshStandardNodeMaterial)
	const nodeMat = new THREE.MeshStandardNodeMaterial( { roughness: 0.3, metalness: 0.2 } );
	nodeMat.colorNode = mix( color( 0x19d3ff ), color( 0x8a2be2 ), sin( time.mul( 2 ) ).mul( 0.5 ).add( 0.5 ) );
	const orb = new THREE.Mesh( new THREE.SphereGeometry( 0.8, 48, 24 ), nodeMat );
	orb.position.set( 4, 0.8, 2.5 );
	orb.castShadow = true;
	add( 'orb', orb );

	// InstancedMesh dinámico (conos/bolardos) con DataTexture
	const count = P.instances;
	const instMat = new THREE.MeshStandardMaterial( { map: makeCheckerDataTexture(), roughness: 0.6 } );
	const inst = new THREE.InstancedMesh( new THREE.BoxGeometry( 0.35, 0.8, 0.35 ), instMat, count );
	inst.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
	inst.castShadow = inst.receiveShadow = true;
	const basePos = [];
	const m4 = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const s1 = new THREE.Vector3( 1, 1, 1 );
	const col = new THREE.Color();
	const side = Math.ceil( Math.sqrt( count ) );
	for ( let i = 0; i < count; i ++ ) {

		const x = ( i % side ) - side / 2;
		const z = Math.floor( i / side );
		const p = new THREE.Vector3( x * 1.6, 0.4, - 12 - z * 1.6 ); // campo de bolardos detrás de la valla
		basePos.push( p );
		m4.compose( p, q, s1 );
		inst.setMatrixAt( i, m4 );
		inst.setColorAt( i, col.setHSL( ( i / count ) * 0.8, 0.7, 0.55 ) );

	}

	inst.instanceMatrix.needsUpdate = true;
	inst.computeBoundingSphere(); // sin esto el culling usa una esfera calculada una sola vez
	add( 'inst', inst );
	R.instancingPath = ( count * 64 <= R.uniformBufferLimit ) ? 'uniform-buffer' : 'instanced-attribute';

	// BatchedMesh: dos geometrías, varias instancias, 1 material
	const batched = new THREE.BatchedMesh( 32, 4096, 8192, new THREE.MeshStandardMaterial( { roughness: 0.5 } ) );
	const gBox = batched.addGeometry( new THREE.BoxGeometry( 0.6, 0.6, 0.6 ) );
	const gSphere = batched.addGeometry( new THREE.SphereGeometry( 0.35, 16, 8 ) );
	for ( let i = 0; i < 12; i ++ ) {

		const id = batched.addInstance( i % 2 === 0 ? gBox : gSphere );
		m4.makeTranslation( - 9 + ( i % 6 ) * 1.2, 0.4, 4 + Math.floor( i / 6 ) * 1.2 );
		batched.setMatrixAt( id, m4 );
		batched.setColorAt( id, col.setHSL( i / 12, 0.6, 0.5 ) );

	}

	batched.castShadow = batched.receiveShadow = true;
	add( 'batched', batched );

	// LOD (se actualiza solo si lod.autoUpdate === true, por defecto)
	const lod = new THREE.LOD();
	const lodMat = new THREE.MeshStandardMaterial( { color: 0xdedede, roughness: 0.4 } );
	lod.addLevel( new THREE.Mesh( new THREE.IcosahedronGeometry( 0.7, 4 ), lodMat ), 0 );
	lod.addLevel( new THREE.Mesh( new THREE.IcosahedronGeometry( 0.7, 1 ), lodMat ), 15 );
	lod.addLevel( new THREE.Mesh( new THREE.IcosahedronGeometry( 0.7, 0 ), lodMat ), 40 );
	lod.position.set( 7, 0.7, - 3 );
	lod.traverse( ( o ) => { if ( o.isMesh ) o.castShadow = true; } );
	add( 'lod', lod );

	// SkinnedMesh animado
	const { mesh: skinned, mixer } = createSkinnedTube();
	skinned.position.set( 0, 1.4, 0 );
	add( 'skinned', skinned );

	// --- post-procesado ------------------------------------------------------
	const { pipeline } = buildPipeline( renderer, scene, camera, P.post );

	// --- bucle ---------------------------------------------------------------
	const timer = new THREE.Timer(); // THREE.Clock está deprecado desde r183
	timer.connect( document );

	let frame = 0;
	const cpuTimes = [];
	const intervals = [];
	let lastStamp = null;
	let measuring = false;
	let firstFrameMs = null;

	const update = ( timestamp ) => {

		timer.update( timestamp );
		const dt = Math.min( timer.getDelta(), 1 / 20 );
		const t = timer.getElapsed();
		mixer.update( dt );
		for ( let i = 0; i < count; i ++ ) {

			const p = basePos[ i ];
			m4.makeTranslation( p.x, p.y + Math.max( 0, Math.sin( t * 3 + i * 0.37 ) ) * 0.25, p.z );
			inst.setMatrixAt( i, m4 );

		}

		inst.instanceMatrix.needsUpdate = true;
		orb.position.y = 0.8 + Math.sin( t * 1.7 ) * 0.2;

	};

	// Modo offscreen: la salida final del pipeline va a un RenderTarget en vez de al canvas
	const offscreenRT = P.offscreen ? new THREE.RenderTarget( P.w, P.h, { type: THREE.UnsignedByteType, depthBuffer: false } ) : null;

	const draw = () => {

		const t0 = performance.now();
		if ( offscreenRT ) renderer.setRenderTarget( offscreenRT );
		pipeline.render(); // con RenderPipeline se llama a pipeline.render(), NO a renderer.render()
		if ( offscreenRT ) renderer.setRenderTarget( null );
		return performance.now() - t0;

	};

	R.status = 'running';

	await new Promise( ( resolve ) => {

		// setAnimationLoop es async: espera a init() si hace falta y registra el callback en el bucle rAF interno.
		renderer.setAnimationLoop( ( timestamp ) => {

			update( timestamp );
			const cpu = draw();
			frame ++;

			if ( frame === 1 ) firstFrameMs = cpu; // incluye compilación de pipelines/shaders
			if ( frame === 10 ) { measuring = true; lastStamp = timestamp; return; }

			if ( measuring ) {

				cpuTimes.push( cpu );
				intervals.push( timestamp - lastStamp );
				lastStamp = timestamp;
				if ( frame % 15 === 0 ) setHud( `backend: ${ R.backend }\npost: ${ P.post }\nframe ${ frame }\ncpu render ${ cpu.toFixed( 1 ) } ms` );
				if ( cpuTimes.length >= P.frames ) {

					// renderer.info se resetea al inicio de cada frame del bucle interno (info.autoReset):
					// hay que leerlo justo después de renderizar, dentro del mismo callback.
					R.info = {
						frame: renderer.info.frame,
						renderCallsTotal: renderer.info.render.calls,
						renderFrameCalls: renderer.info.render.frameCalls,
						drawCalls: renderer.info.render.drawCalls,
						triangles: renderer.info.render.triangles,
						memory: { ...renderer.info.memory }
					};
					renderer.setAnimationLoop( null );
					resolve();

				}

			}

		} );

	} );

	R.timings.firstFrameCpuMs = Math.round( firstFrameMs );
	R.timings.loopCpu = stats( cpuTimes );
	R.timings.rafInterval = stats( intervals );

	// Medición sincronizada con la GPU: render + espera a que la GPU termine
	const syncTimes = [];
	const gpuSync = async () => {

		if ( backend.isWebGPUBackend ) {

			await backend.device.queue.onSubmittedWorkDone();

		} else {

			// gl.finish() no bloquea de forma fiable en Chrome: usamos un fence y sondeo
			const gl = backend.gl;
			const sync = gl.fenceSync( gl.SYNC_GPU_COMMANDS_COMPLETE, 0 );
			gl.flush();
			await new Promise( ( resolve ) => {

				const poll = () => {

					const s = gl.clientWaitSync( sync, 0, 0 );
					if ( s === gl.TIMEOUT_EXPIRED ) { setTimeout( poll, 1 ); return; }
					gl.deleteSync( sync );
					resolve();

				};

				poll();

			} );

		}

	};

	await gpuSync(); // vaciar la cola: los frames del bucle rAF pueden ir por delante de la GPU

	for ( let i = 0; i < 20; i ++ ) {

		await nextFrame();
		const t0 = performance.now();
		update( performance.now() );
		draw();
		await gpuSync();
		syncTimes.push( performance.now() - t0 );

	}

	R.timings.syncedFrame = stats( syncTimes );

	if ( offscreenRT ) {

		// Volcado del RenderTarget a un canvas 2D (para la captura de pantalla)
		draw();
		const px = await renderer.readRenderTargetPixelsAsync( offscreenRT, 0, 0, P.w, P.h );
		blitToCanvas2D( px, P.w, P.h, backend.isWebGLBackend === true );

	} else {

		// Dejamos el bucle activo para la captura
		renderer.setAnimationLoop( ( timestamp ) => { update( timestamp ); draw(); } );
		await nextFrame(); await nextFrame();

	}

	if ( P.lose ) {

		await testDeviceLoss( renderer );

	}

	R.status = 'ok';
	setHud( `backend: ${ R.backend }${ R.compatibilityMode ? ' (compat)' : '' }\npost: ${ P.post }  aa: ${ P.aa ? 'MSAA' : 'no' }\n` +
		`render cpu ~${ R.timings.loopCpu.median } ms · gpu-sync ~${ R.timings.syncedFrame.median } ms\n` +
		`drawCalls ${ R.info.drawCalls } · tris ${ R.info.triangles }` );

}

function blitToCanvas2D( px, w, h, flipY ) {

	// WebGPU alinea cada fila de la lectura a 256 bytes; WebGL devuelve las filas de abajo arriba.
	const rowBytes = h > 1 ? ( px.length - w * 4 ) / ( h - 1 ) : w * 4;
	const out = new Uint8ClampedArray( w * h * 4 );
	for ( let y = 0; y < h; y ++ ) {

		const srcY = flipY ? h - 1 - y : y;
		out.set( px.subarray( srcY * rowBytes, srcY * rowBytes + w * 4 ), y * w * 4 );

	}

	for ( let i = 3; i < out.length; i += 4 ) out[ i ] = 255;
	const c = document.createElement( 'canvas' );
	c.width = w; c.height = h;
	c.style.cssText = 'position:fixed;left:0;top:0;';
	c.getContext( '2d' ).putImageData( new ImageData( out, w, h ), 0, 0 );
	document.body.appendChild( c );

}

async function testDeviceLoss( renderer ) {

	const backend = renderer.backend;
	R.lossTest = { api: R.backend };

	if ( backend.isWebGLBackend ) {

		const ext = backend.gl.getExtension( 'WEBGL_lose_context' );
		if ( ! ext ) { R.lossTest.result = 'sin WEBGL_lose_context'; return; }
		ext.loseContext();
		for ( let i = 0; i < 10 && ! R.deviceLost; i ++ ) await nextFrame();
		R.lossTest.onDeviceLostCalled = !! R.deviceLost;
		R.lossTest.isDeviceLost = renderer._isDeviceLost;

	} else {

		// device.destroy() produce reason === 'destroyed', que three IGNORA a propósito
		backend.device.destroy();
		for ( let i = 0; i < 10; i ++ ) await nextFrame();
		R.lossTest.onDeviceLostCalled = !! R.deviceLost;
		R.lossTest.note = 'device.destroy() => reason "destroyed": three no llama a onDeviceLost';

	}

}

main().catch( ( e ) => {

	R.status = 'error';
	R.errors.push( 'main: ' + ( e && e.stack || e ) );
	setHud( 'ERROR\n' + ( e && e.message || e ) );

} );
