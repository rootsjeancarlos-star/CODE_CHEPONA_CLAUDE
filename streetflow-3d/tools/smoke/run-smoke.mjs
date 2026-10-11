#!/usr/bin/env node
// STREETFLOW 3D — ejecuta tools/smoke/smoke-webgpu.html en Chromium headless (Playwright)
// con varias combinaciones de flags y guarda capturas + results.json en tools/smoke/out/.
//
// Uso (desde la raíz del proyecto):
//   node tools/smoke/run-smoke.mjs              # arranca Vite en :5199 y ejecuta la matriz completa
//   node tools/smoke/run-smoke.mjs --quick      # solo las combinaciones de navegador (sin matriz de post)
//   node tools/smoke/run-smoke.mjs --url http://127.0.0.1:5199   # usa un servidor Vite ya arrancado
//   node tools/smoke/run-smoke.mjs --only webgpu-min             # solo los casos cuyo nombre contenga el texto
//
// Requiere @playwright/test (devDependency) y navegadores en PLAYWRIGHT_BROWSERS_PATH (p.ej. /opt/pw-browsers).

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname( fileURLToPath( import.meta.url ) );
const ROOT = path.resolve( HERE, '../..' );
const OUT = path.join( HERE, 'out' );
const PAGE = '/tools/smoke/smoke-webgpu.html';

const argv = process.argv.slice( 2 );
const argValue = ( name ) => { const i = argv.indexOf( name ); return i >= 0 ? argv[ i + 1 ] : null; };
const QUICK = argv.includes( '--quick' );
const ONLY = argValue( '--only' );
let baseUrl = argValue( '--url' );

// Chromium completo (modo "new headless"); por defecto Playwright usa chromium-headless-shell en headless.
const FULL_CHROME = process.env.SMOKE_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// ---------------------------------------------------------------------------
// Combinaciones de navegador
// ---------------------------------------------------------------------------

const WEBGPU_FLAGS_TASK = [ '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader' ];
const WEBGPU_FLAGS_MIN = [ '--enable-unsafe-webgpu' ];

const browsers = {
	'shell-default': { launch: {}, desc: 'headless (chromium-headless-shell) sin flags' },
	'shell-webgpu-flags': { launch: { args: WEBGPU_FLAGS_TASK }, desc: 'headless-shell + ' + WEBGPU_FLAGS_TASK.join( ' ' ) },
	'shell-webgpu-min': { launch: { args: WEBGPU_FLAGS_MIN }, desc: 'headless-shell + --enable-unsafe-webgpu' },
	'newheadless-default': { launch: { executablePath: FULL_CHROME }, desc: 'Chromium completo (new headless) sin flags' },
	'newheadless-webgpu-min': { launch: { executablePath: FULL_CHROME, args: WEBGPU_FLAGS_MIN }, desc: 'Chromium completo (new headless) + --enable-unsafe-webgpu' },
	'no-gpu': { launch: { args: [ '--disable-gpu', '--disable-software-rasterizer' ] }, desc: 'headless-shell + --disable-gpu --disable-software-rasterizer (sin WebGPU ni WebGL2)' }
};

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

// expect: resultado esperado en ESTE contenedor (sin GPU, Chromium 141 + SwiftShader).
//   ok | device-lost | error | no-backend
// En WebGPU, presentar en el <canvas> pierde el dispositivo (Chromium no puede crear la SharedImage
// del swap chain sin GPU), así que WebGPU se prueba con offscreen=1 (render a RenderTarget + lectura).
const cases = [
	{ name: 'a-shell-default', browser: 'shell-default', query: {}, expect: 'ok', expectBackend: 'WebGL2' },
	{ name: 'b-shell-webgpu-flags-canvas', browser: 'shell-webgpu-flags', query: { frames: 10 }, expect: 'device-lost', expectBackend: 'WebGPU' },
	{ name: 'b-shell-webgpu-flags-offscreen', browser: 'shell-webgpu-flags', query: { offscreen: 1 }, expect: 'ok', expectBackend: 'WebGPU' },
	{ name: 'b-shell-webgpu-min-canvas', browser: 'shell-webgpu-min', query: { frames: 10 }, expect: 'device-lost', expectBackend: 'WebGPU' },
	{ name: 'b-shell-webgpu-min-offscreen', browser: 'shell-webgpu-min', query: { offscreen: 1 }, expect: 'ok', expectBackend: 'WebGPU' },
	{ name: 'b-shell-webgpu-min-offscreen-noShim', browser: 'shell-webgpu-min', query: { offscreen: 1, noSwizzleShim: 1, frames: 10 }, expect: 'error', expectBackend: 'WebGPU' },
	{ name: 'b-shell-webgpu-min-forceWebGL-canvas', browser: 'shell-webgpu-min', query: { forceWebGL: 1 }, expect: 'ok', expectBackend: 'WebGL2' },
	{ name: 'c-newheadless-default', browser: 'newheadless-default', query: {}, expect: 'ok', expectBackend: 'WebGL2' },
	{ name: 'c-newheadless-webgpu-min-offscreen', browser: 'newheadless-webgpu-min', query: { offscreen: 1 }, expect: 'ok', expectBackend: 'WebGPU' },
	{ name: 'd-no-gpu', browser: 'no-gpu', query: {}, expect: 'no-backend' }
];

if ( ! QUICK ) {

	// Matriz de post-procesado/sombras: ambos backends en offscreen para que sean comparables.
	const posts = [ 'none', 'bloom', 'bloom-fxaa', 'bloom-smaa', 'bloom-traa', 'ssao-bloom', 'gtao-traa-bloom' ];
	for ( const [ tag, forceWebGL, backend ] of [ [ 'webgpu', 0, 'WebGPU' ], [ 'webgl2', 1, 'WebGL2' ] ] ) {

		const base = { forceWebGL, offscreen: 1, frames: 30 };
		const add = ( suffix, extra, expect = 'ok' ) => cases.push( { name: `m-${ tag }-${ suffix }`, browser: 'shell-webgpu-min', query: { ...base, ...extra }, expect, expectBackend: backend } );
		for ( const post of posts ) add( 'post-' + post, { post } );
		add( 'csm', { csm: 1 } );
		add( 'vsm', { shadowType: 'vsm' } );
		add( 'msaa', { aa: 1 } );
		add( 'agx', { tonemap: 'agx' } );
		add( 'noshadows', { skip: 'shadows' } );
		add( 'lose', { lose: 1, frames: 10 } );

	}

}

// ---------------------------------------------------------------------------
// Vite
// ---------------------------------------------------------------------------

async function startVite() {

	const { createServer } = await import( 'vite' );
	const server = await createServer( {
		root: ROOT,
		logLevel: 'warn',
		server: { port: 5199, strictPort: true, host: '127.0.0.1' },
		optimizeDeps: {
			// Pre-empaquetar desde el inicio evita recargas de página a mitad de prueba
			entries: [ 'tools/smoke/smoke-webgpu.html' ],
			include: [
				'three/webgpu', 'three/tsl',
				'three/addons/tsl/display/BloomNode.js', 'three/addons/tsl/display/FXAANode.js',
				'three/addons/tsl/display/SMAANode.js', 'three/addons/tsl/display/TRAANode.js',
				'three/addons/tsl/display/SSAONode.js', 'three/addons/tsl/display/GTAONode.js',
				'three/addons/objects/SkyMesh.js', 'three/addons/csm/CSMShadowNode.js',
				'three/addons/capabilities/WebGPU.js', 'three/addons/capabilities/WebGL.js'
			]
		}
	} );
	await server.listen();
	return server;

}

// ---------------------------------------------------------------------------
// Ejecución de un caso
// ---------------------------------------------------------------------------

async function runCase( c ) {

	const b = browsers[ c.browser ];
	const result = { name: c.name, browser: c.browser, browserDesc: b.desc, query: c.query };
	const t0 = Date.now();
	let browser;

	try {

		browser = await chromium.launch( { headless: true, ...b.launch } );
		result.browserVersion = browser.version();
		const page = await browser.newPage( { viewport: { width: 960, height: 540 } } );

		const consoleMsgs = [];
		page.on( 'console', ( m ) => consoleMsgs.push( { type: m.type(), text: m.text().slice( 0, 400 ) } ) );
		page.on( 'pageerror', ( e ) => consoleMsgs.push( { type: 'pageerror', text: String( e && e.stack || e ).slice( 0, 600 ) } ) );

		const qs = new URLSearchParams( c.query ).toString();
		await page.goto( baseUrl + PAGE + ( qs ? '?' + qs : '' ), { waitUntil: 'load' } );

		await page.waitForFunction( () => {

			const s = window.__SMOKE__;
			return s && [ 'ok', 'error', 'no-backend' ].includes( s.status );

		}, null, { timeout: 240000, polling: 250 } );

		const smoke = await page.evaluate( () => JSON.parse( JSON.stringify( window.__SMOKE__ ) ) );
		Object.assign( result, smoke );
		result.outcome = smoke.deviceLost && ! smoke.lossTest ? 'device-lost' : smoke.status;

		await mkdir( OUT, { recursive: true } );
		const shot = path.join( OUT, c.name + '.png' );
		await page.screenshot( { path: shot } );
		result.screenshot = path.relative( ROOT, shot );

		result.console = {
			errors: consoleMsgs.filter( ( m ) => m.type === 'error' || m.type === 'pageerror' ).map( ( m ) => m.text ),
			warnings: consoleMsgs.filter( ( m ) => m.type === 'warning' ).map( ( m ) => m.text )
		};

	} catch ( e ) {

		result.status = result.outcome = 'runner-error';
		result.runnerError = String( e && e.message || e ).split( '\n' )[ 0 ];

	} finally {

		if ( browser ) await browser.close();

	}

	result.wallMs = Date.now() - t0;
	result.expect = c.expect;
	result.asExpected = result.outcome === c.expect && ( ! c.expectBackend || result.backend === c.expectBackend );
	return result;

}

function summaryLine( r ) {

	const t = r.timings || {};
	const med = ( s ) => ( s ? s.median : '-' );
	return [
		( r.asExpected ? '  ' : '!!' ) + ' ' + r.name.padEnd( 40 ),
		String( r.outcome ).padEnd( 11 ),
		String( r.backend || '-' ).padEnd( 7 ),
		`init ${ t.initMs ?? '-' }ms`.padEnd( 12 ),
		`1er ${ t.firstFrameCpuMs ?? '-' }ms`.padEnd( 11 ),
		`cpu ${ med( t.loopCpu ) }ms`.padEnd( 13 ),
		`raf ${ med( t.rafInterval ) }ms`.padEnd( 13 ),
		`sync ${ med( t.syncedFrame ) }ms`.padEnd( 14 ),
		`dc ${ r.info ? r.info.drawCalls : '-' }`.padEnd( 7 ),
		`err ${ ( r.console ? r.console.errors.length : 0 ) + ( r.errors ? r.errors.length : 0 ) }`
	].join( ' ' );

}

// ---------------------------------------------------------------------------

async function main() {

	let server = null;
	if ( ! baseUrl ) {

		server = await startVite();
		baseUrl = 'http://127.0.0.1:5199';

	}

	if ( ! existsSync( FULL_CHROME ) ) console.warn( 'Aviso: no existe ' + FULL_CHROME + ' (casos new headless fallarán). Define SMOKE_CHROME.' );

	const selected = cases.filter( ( c ) => ! ONLY || c.name.includes( ONLY ) );
	const results = [];
	const tAll = Date.now();

	try {

		// Calentamiento: la primera carga hace que Vite transforme/optimice módulos
		if ( server ) await runCase( { name: 'warmup', browser: 'shell-default', query: { frames: 5 }, expect: 'ok' } );

		for ( const c of selected ) {

			const r = await runCase( c );
			results.push( r );
			console.log( summaryLine( r ) );

		}

	} finally {

		if ( server ) await server.close();

	}

	await mkdir( OUT, { recursive: true } );
	await writeFile( path.join( OUT, 'results.json' ), JSON.stringify( { date: new Date().toISOString(), totalMs: Date.now() - tAll, results }, null, 2 ) );
	console.log( `\n${ results.length } casos en ${ Math.round( ( Date.now() - tAll ) / 1000 ) } s. Resultados: ${ path.relative( ROOT, path.join( OUT, 'results.json' ) ) }` );

	const unexpected = results.filter( ( r ) => ! r.asExpected );
	if ( unexpected.length ) {

		console.log( 'Casos con resultado NO esperado: ' + unexpected.map( ( r ) => `${ r.name } (obtenido ${ r.outcome }/${ r.backend }, esperado ${ r.expect })` ).join( ', ' ) );
		process.exitCode = 1;

	} else {

		console.log( 'Todos los casos dieron el resultado esperado para este entorno.' );

	}

}

main().catch( ( e ) => { console.error( e ); process.exit( 1 ); } );
