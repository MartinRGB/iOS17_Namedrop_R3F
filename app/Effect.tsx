'use client'
import React, { createRef, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, createPortal, extend, useFrame, useLoader, useThree, invalidate } from '@react-three/fiber';
import { Plane, shaderMaterial, useFBO } from '@react-three/drei';
import { ShaderMaterial, TextureLoader } from 'three';
import * as THREE from 'three'

const prefix_vertex = `
    varying vec2 vUv;
    varying vec3 v_pos;

`

const common_vertex_main = `
    void main()	{
        vUv = uv;
        v_pos = position;
        gl_Position = vec4(position, 1.);
    }
`

const prefix_frag = `
    #ifdef GL_ES
    precision mediump float;
    #endif

    varying vec3 v_pos;
    varying vec2 vUv;
`

// # dual kawase blur downsale shader pass
const BlurDownSampleMaterial = shaderMaterial(
    {
      time: 0,
      buff_tex: null,
      resolution: [600, 600],
    },
    prefix_vertex + common_vertex_main,
    prefix_frag + `
        uniform float time;
        uniform vec2 resolution;
        uniform sampler2D buff_tex;
    
        void main() {
            vec2 uv = vUv*2.0;
            vec2 halfpixel = 0.5 / (resolution.xy / 2.0);
            float time_offset = (sin(time*4.) + 1.)/2.;
            float blur_offset = 6. * time_offset;
        
            vec4 sum;
            sum = texture(buff_tex, uv) * 4.0;
            sum += texture(buff_tex, uv - halfpixel.xy * blur_offset);
            sum += texture(buff_tex, uv + halfpixel.xy * blur_offset);
            sum += texture(buff_tex, uv + vec2(halfpixel.x, -halfpixel.y) * blur_offset);
            sum += texture(buff_tex, uv - vec2(halfpixel.x, -halfpixel.y) * blur_offset);
        
            gl_FragColor = sum / 8.0;
        }
    `
);

const BlurUpSampleMaterial = shaderMaterial(

    {
        time: 0,
        buff_tex: null,
        resolution: [600, 600],
    },
    prefix_vertex + common_vertex_main,
    prefix_frag + `
        uniform float time;
        uniform vec2 resolution;
        uniform sampler2D buff_tex;

        void main() {

            vec2 uv = vUv/2.0;
            vec2 halfpixel = 0.5 / (resolution.xy * 2.0);
            float time_offset = (sin(time*4.) + 1.)/2.;
            float blur_offset = 6. * time_offset;
        
            vec4 sum;
            
            sum =  texture(buff_tex, uv +vec2(-halfpixel.x * 2.0, 0.0) * blur_offset);
            sum += texture(buff_tex, uv + vec2(-halfpixel.x, halfpixel.y) * blur_offset) * 2.0;
            sum += texture(buff_tex, uv + vec2(0.0, halfpixel.y * 2.0) * blur_offset);
            sum += texture(buff_tex, uv + vec2(halfpixel.x, halfpixel.y) * blur_offset) * 2.0;
            sum += texture(buff_tex, uv + vec2(halfpixel.x * 2.0, 0.0) * blur_offset);
            sum += texture(buff_tex, uv + vec2(halfpixel.x, -halfpixel.y) * blur_offset) * 2.0;
            sum += texture(buff_tex, uv + vec2(0.0, -halfpixel.y * 2.0) * blur_offset);
            sum += texture(buff_tex, uv + vec2(-halfpixel.x, -halfpixel.y) * blur_offset) * 2.0;
        
            gl_FragColor = sum / 12.0;
        }
    `
)

const WaveMaterial =  shaderMaterial(
    {
        time: 0,
        buff_tex: null,
        resolution: [600, 600],
    },
    prefix_vertex + common_vertex_main,
    prefix_frag + `
    uniform float time;
    uniform vec2 resolution;
    uniform sampler2D buff_tex;
    #define iTime time
    #define iChannel0 buff_tex
    #define iResolution resolution

    float rand(vec2 co){
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    vec4 waveEffect(in vec2 uv){
        //Sawtooth function to pulse from centre.
        float offset = (iTime- floor(iTime))/iTime;
        float CurrentTime = (iTime)*(offset);    
        
        vec3 WaveParams = vec3(10.0, 0.8, 0.1);// distance,height,time
        
        float ratio = iResolution.y/iResolution.x;
           
        vec2 WaveCentre = vec2(0.5, 0.9);
        WaveCentre.y *= ratio; 
       
        vec2 texCoord = gl_FragCoord.xy / iResolution.xy;    
        texCoord.y *= ratio;    
        texCoord = uv;  
        
        //vec2 waveCoord = texCoord;
        //waveCoord.y *= ratio;
        float Dist = distance(vec2(texCoord.x,texCoord.y*2.), WaveCentre);

        vec4 Color = texture(iChannel0, texCoord);
        
        float outputCol;
        //Only distort the pixels within the parameter distance from the centre
        if ((Dist <= ((CurrentTime) + (WaveParams.z))) && (Dist >= ((CurrentTime) - (WaveParams.z)))) 
        {
            //The pixel offset distance based on the input parameters
            float Diff = (Dist - CurrentTime); 
            float ScaleDiff = (1.0 - pow(abs(Diff * WaveParams.x), WaveParams.y)); 
            float DiffTime = (Diff  * ScaleDiff);
            
            //The direction of the distortion
            vec2 DiffTexCoord = normalize(texCoord - WaveCentre);         
            
            //Perform the distortion and reduce the effect over time
            texCoord += ((DiffTexCoord * DiffTime) / (CurrentTime * Dist * 40.0));
            Color = texture(iChannel0, texCoord);
            
            //Blow out the color and reduce the effect over time
            Color += (Color * ScaleDiff) / (CurrentTime * Dist * 40.0);

            outputCol = ScaleDiff;
            
        } 

        //return vec4(vec3(outputCol),1.);
        return Color;
    }

    void main() {

        gl_FragColor = waveEffect(vUv);
    }
`);

extend({BlurDownSampleMaterial,BlurUpSampleMaterial,WaveMaterial})

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'blurDownSampleMaterial': React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
            'blurUpSampleMaterial': React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
            'waveMaterial': React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
        }
    }
}

const Interface = () => {

    const wp = useLoader(TextureLoader, './wallpaper.png')
    const ct = useLoader(TextureLoader, './contact.png')

    // # the renderer's context
    const {size,gl,scene,camera} = useThree()
    // # create Material ref for 'uniforms input'
    const kawaseBlurMaterialRefA = useRef<ShaderMaterial | null>(null)
    const kawaseBlurMaterialRefB = useRef<ShaderMaterial | null>(null)
    const kawaseBlurMaterialRefC = useRef<ShaderMaterial | null>(null)
    const kawaseBlurMaterialRefD = useRef<ShaderMaterial | null>(null)
    const waveMaterialRef = useRef<ShaderMaterial | null>(null)

    const FBOSettings ={
        format: THREE.RGBAFormat,
        //encoding:THREE.GammaEncoding,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        type: THREE.FloatType,
    };
    // # create FBO for different render pass
    const kawaseBlurFBOA = useFBO(size.width,size.height,FBOSettings);
    const kawaseBlurFBOB = useFBO(size.width,size.height,FBOSettings);
    const kawaseBlurFBOC = useFBO(size.width,size.height,FBOSettings);
    const kawaseBlurFBOD = useFBO(size.width,size.height,FBOSettings);

    // # create scenes for different FBOS
    const [kawaseBlurSceneA,kawaseBlurSceneB,kawaseBlurSceneC,kawaseBlurSceneD] = useMemo(() => {
        const kawaseBlurSceneA = new THREE.Scene()
        const kawaseBlurSceneB = new THREE.Scene()
        const kawaseBlurSceneC = new THREE.Scene()
        const kawaseBlurSceneD = new THREE.Scene()
        
        return [kawaseBlurSceneA,kawaseBlurSceneB,kawaseBlurSceneC,kawaseBlurSceneD]
    }, []) 

    // #
    useEffect(()=>{
        if(waveMaterialRef.current){
            waveMaterialRef.current.uniforms.resolution.value = new THREE.Vector2(size.width,size.height)
        }

    },[])
    
    // #
    useFrame(({clock})=>{
        const time = clock.getElapsedTime()
        console.log('123')
        // DownSample - Pass 1
        if(kawaseBlurMaterialRefA.current){
            kawaseBlurMaterialRefA.current.uniforms.buff_tex.value = wp;
            kawaseBlurMaterialRefA.current.uniforms.time.value = time;

            // Pass 1 Buffer
            gl.setRenderTarget(kawaseBlurFBOA);
            gl.render(kawaseBlurSceneA,camera)
            gl.setRenderTarget(null)
        }
            

        // DownSample - Pass 2
        if(kawaseBlurMaterialRefB.current){
            kawaseBlurMaterialRefB.current.uniforms.buff_tex.value = kawaseBlurFBOA.texture
            kawaseBlurMaterialRefB.current.uniforms.time.value = time;

            // Pass 2 Buffer
            gl.setRenderTarget(kawaseBlurFBOB);
            gl.render(kawaseBlurSceneB,camera)
            gl.setRenderTarget(null)
        }

        // UpSample - Pass 3
        if(kawaseBlurMaterialRefC.current){
            kawaseBlurMaterialRefC.current.uniforms.buff_tex.value = kawaseBlurFBOB.texture
            kawaseBlurMaterialRefC.current.uniforms.time.value = time;

            // Pass 3 Buffer
            gl.setRenderTarget(kawaseBlurFBOC);
            gl.render(kawaseBlurSceneC,camera)
            gl.setRenderTarget(null)
        }

        // UpSample - Pass 4        
        if(kawaseBlurMaterialRefD.current){
            kawaseBlurMaterialRefD.current.uniforms.buff_tex.value = kawaseBlurFBOC.texture
            kawaseBlurMaterialRefD.current.uniforms.time.value = time;

            // Pass 4 Buffer
            gl.setRenderTarget(kawaseBlurFBOD);
            gl.render(kawaseBlurSceneD,camera)
            gl.setRenderTarget(null)
        }

        // WaveMaterial Pass
        if(waveMaterialRef.current){
            waveMaterialRef.current.uniforms.buff_tex.value = kawaseBlurFBOD.texture
            waveMaterialRef.current.uniforms.time.value = time;
        }


        // to do : swap material
    })
    return (
    <>
        {createPortal(<>
          <Plane args={[2, 2]}>
             <blurDownSampleMaterial ref={kawaseBlurMaterialRefA}  />
          </Plane>
        </>, kawaseBlurSceneA)}

        {createPortal(<>
          <Plane args={[2, 2]}>
             <blurDownSampleMaterial ref={kawaseBlurMaterialRefB}  />
          </Plane>
        </>, kawaseBlurSceneB)}

        {createPortal(<>
          <Plane args={[2, 2]}>
             <blurUpSampleMaterial ref={kawaseBlurMaterialRefC}  />
          </Plane>
        </>, kawaseBlurSceneC)}

        {createPortal(<>
          <Plane args={[2, 2]}>
             <blurUpSampleMaterial ref={kawaseBlurMaterialRefD}  />
          </Plane>
        </>, kawaseBlurSceneD)}

        <Plane args={[2, 2]}>
             <waveMaterial ref={waveMaterialRef}  />
        </Plane>

    </>
    )

}

export const Effect = (props:any) =>{
  return(
  <Canvas className={props.className} style={{...props.style}}>
    <ambientLight />
    <Interface />
  </Canvas>
  )
}