// UNO_patch_arch3d_bloom_loader.js
// Lightweight Atlas 3D + PostBloom loader for DualOrb
// Exposes global initAtlas3D(root, options) and UNO.initAtlas(root, options)
// Assumes THREE (rXX+) is already loaded on the page. Does not fetch external libs.
// Options: { bloom: true/false, post: true/false, intensity: number, autoResize: true/false }

(function(global){
  const DEFAULTS = { bloom:true, post:true, intensity:1.0, autoResize:true, orbitControls:false };

  function ensure(name){
    return Boolean(global[name]);
  }

  function createGradientTexture(colors, size){
    // colors: array of stops [{offset:0..1, color:'#rrggbb' or 'rgba(...)'}]
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(64, size||256);
    canvas.height = 2;
    const ctx = canvas.getContext('2d');
    const grd = ctx.createLinearGradient(0,0,canvas.width,0);
    colors.forEach(stop => grd.addColorStop(stop.offset, stop.color));
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,canvas.width,canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function initAtlas3D(rootElement, opts){
    if(!rootElement){ console.warn('[initAtlas3D] rootElement required'); return null; }
    const options = Object.assign({}, DEFAULTS, opts || {});
    if(!ensure('THREE')){
      console.warn('[initAtlas3D] THREE not found on page. Please include three.js before calling initAtlas3D.');
      return null;
    }

    // Prevent multiple inits on same root
    if(rootElement.__atlasInstance){
      console.log('[initAtlas3D] Atlas already initialized on this element. Returning existing instance.');
      return rootElement.__atlasInstance.api;
    }

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 3.6);

    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0); // transparent background

    // mount renderer
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.pointerEvents = 'none';
    rootElement.appendChild(renderer.domElement);

    // Resize helper
    function resize(){
      const r = rootElement.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      if(composer && composer.setSize) composer.setSize(w, h);
    }

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.8);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(3,4,2);
    scene.add(dir);

    // Orb geometry + material
    const geom = new THREE.IcosahedronGeometry(1.0, 64); // smooth sphere-like mesh
    // Create a custom shader-like material using onBeforeCompile for simple bands + swirl
    const baseMat = new THREE.MeshStandardMaterial({
      roughness: 0.25,
      metalness: 0.1,
      envMapIntensity: 0.6,
      emissiveIntensity: 0.6,
      toneMapped: true
    });

    // gradient texture for emissive tint
    const gradTex = createGradientTexture([
      {offset:0.0, color:'#7a3cff'},
      {offset:0.5, color:'#9b5cff'},
      {offset:1.0, color:'#00e5ff'}
    ], 512);
    baseMat.emissiveMap = gradTex;
    baseMat.emissive = new THREE.Color(0xffffff);

    // tweak shader to produce bands effect in fragment shader
    baseMat.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };
      shader.uniforms.intensity = { value: options.intensity || 1.0 };
      shader.vertexShader = 'varying vec3 vPos; ' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vPos = position;'
      );
      shader.fragmentShader = 'uniform float time; uniform float intensity; varying vec3 vPos; ' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        [
          'float bands = 0.5 + 0.5 * sin(vPos.x * 8.0 + vPos.y * 6.0 + time * 0.8);',
          'float swirl = 0.25 * sin(vPos.x * 10.0 + time * 1.2) * cos(vPos.y * 6.0 + time * 0.6);',
          'float mixv = clamp(bands * 0.7 + swirl * 0.3, 0.0, 1.0);',
          'vec3 grad = texture2D( emissiveMap, vec2(mixv, 0.5) ).rgb;',
          'vec3 finalEmissive = grad * (0.6 + 0.6 * intensity);',
          'vec4 diffuseColor = vec4( diffuse + finalEmissive, opacity );'
        ].join('\n')
      );
      // expose a reference to update time
      baseMat.userData._shader = shader;
    };

    const mesh = new THREE.Mesh(geom, baseMat);
    mesh.renderOrder = 1;
    scene.add(mesh);

    // subtle particle points around orb
    const partCount = 160;
    const partGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(partCount * 3);
    const colors = new Float32Array(partCount * 3);
    for(let i=0;i<partCount;i++){
      const phi = Math.acos(2*Math.random()-1);
      const th = Math.random() * Math.PI * 2;
      const r = 1.12 + Math.random()*0.6;
      const x = Math.sin(phi)*Math.cos(th)*r;
      const y = Math.sin(phi)*Math.sin(th)*r;
      const z = Math.cos(phi)*r;
      positions[i*3+0]=x; positions[i*3+1]=y; positions[i*3+2]=z;
      const hue = 200 + Math.random()*160;
      const col = new THREE.Color(`hsl(${hue}, 90%, 65%)`);
      colors[i*3+0]=col.r; colors[i*3+1]=col.g; colors[i*3+2]=col.b;
    }
    partGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    partGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const partMat = new THREE.PointsMaterial({ size: 0.02, vertexColors:true, transparent:true, opacity:0.9 });
    const points = new THREE.Points(partGeo, partMat);
    points.renderOrder = 0;
    scene.add(points);

    // postprocessing (composer + bloom) if available
    let composer = null;
    if(options.post && ensure('THREE') && (THREE.EffectComposer || global.EffectComposer)){
      try{
        const EC = global.EffectComposer || THREE.EffectComposer;
        const RenderPass = global.RenderPass || THREE.RenderPass;
        const UnrealBloomPass = global.UnrealBloomPass || THREE.UnrealBloomPass;
        const ShaderPass = global.ShaderPass || THREE.ShaderPass;
        // graceful fallback if any pass missing
        if(EC && RenderPass){
          composer = new EC(renderer);
          const renderPass = new RenderPass(scene, camera);
          composer.addPass(renderPass);
          if(options.bloom && UnrealBloomPass){
            const bloomPass = new UnrealBloomPass(new THREE.Vector2(rootElement.clientWidth||512, rootElement.clientHeight||512), 1.2 * (options.intensity||1.0), 0.4, 0.85);
            bloomPass.threshold = 0.1;
            bloomPass.strength = 0.8 * (options.intensity||1.0);
            bloomPass.radius = 0.5;
            composer.addPass(bloomPass);
          }
        }
      }catch(e){
        console.warn('[initAtlas3D] postprocessing init failed', e);
        composer = null;
      }
    }

    // simple animation loop
    let stopped = false;
    let last = performance.now();
    function animate(){
      if(stopped) return;
      const now = performance.now();
      const dt = (now - last) * 0.001;
      last = now;
      // rotate mesh and particles
      mesh.rotation.y += 0.25 * dt;
      mesh.rotation.x += 0.08 * dt;
      points.rotation.y -= 0.12 * dt;

      // update shader time if present
      if(baseMat.userData && baseMat.userData._shader && baseMat.userData._shader.uniforms && baseMat.userData._shader.uniforms.time){
        baseMat.userData._shader.uniforms.time.value = now * 0.001;
        baseMat.userData._shader.uniforms.intensity.value = options.intensity || 1.0;
      }
      // render
      if(composer){
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
      requestAnimationFrame(animate);
    }

    // initial resize and start
    if(options.autoResize !== false) {
      resize();
      window.addEventListener('resize', resize);
    }
    requestAnimationFrame(animate);

    // Public API for instance
    const api = {
      root: rootElement,
      scene, camera, renderer, mesh, points, composer,
      setIntensity(v){ options.intensity=v; if(baseMat.userData && baseMat.userData._shader && baseMat.userData._shader.uniforms) baseMat.userData._shader.uniforms.intensity.value = v; },
      dispose(){ stopped=true; try{ if(renderer && renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }catch(e){} window.removeEventListener('resize', resize); rootElement.__atlasInstance = null; }
    };

    // attach to root so we can detect duplicates
    rootElement.__atlasInstance = { api, internal:{scene, renderer, mesh} };

    return api;
  }

  // Expose globally
  global.initAtlas3D = initAtlas3D;
  global.UNO = global.UNO || {};
  global.UNO.initAtlas = initAtlas3D;

  // Also support ES module default export if used as <script type="module">
  try{
    // no-op; exporting in module environment isn't necessary in this pattern
  }catch(e){}

})(window);
