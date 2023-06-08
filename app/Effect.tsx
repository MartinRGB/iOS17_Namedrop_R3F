'use client'
import React, { useEffect, useRef, useState } from 'react'
import { Canvas, extend, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Plane, shaderMaterial } from '@react-three/drei';
import { ShaderMaterial, TextureLoader } from 'three';

// const BlurDownSampleMaterial = shaderMaterial(
//     {
//       time: 0,
//       wp_tex: null,
//       ct_tex:null,
//       resolution: [600, 600],
//     },
//     /* glsl */ `
//     varying vec2 vUv;
//     varying vec3 v_pos;
//     void main()	{
//     vUv = uv;
//     v_pos = position;
//     gl_Position = vec4(position, 1.);
//     }
//     `,
//     /* glsl */ `
//     #ifdef GL_ES
//     precision mediump float;
//     #endif
    
//     varying vec3 v_pos;
  
//     uniform float time;
//     uniform vec2 resolution;
//     uniform sampler2D ct_tex;
//     uniform sampler2D wp_tex;
//     varying vec2 vUv;
  
//     void main() {
//         vec4 ct = texture2D(ct_tex, vUv);
//         vec4 wp = texture2D(wp_tex, vUv);
//         gl_FragColor=vec4(vUv.x,vUv.y,0.0,1.0);
//         gl_FragColor = wp;
//     }
  
//   `
// );

const BlurDownSampleMaterial = shaderMaterial(
    {
      time: 0,
      buff_tex: null,
      resolution: [600, 600],
    },
    /* glsl */ `
    varying vec2 vUv;
    varying vec3 v_pos;
    void main()	{
        vUv = uv;
        v_pos = position;
        gl_Position = vec4(position, 1.);
    }
    `,
    /* glsl */ `
    #ifdef GL_ES
    precision mediump float;
    #endif
    
    varying vec3 v_pos;
  
    uniform float time;
    uniform vec2 resolution;
    uniform sampler2D buff_tex;
    varying vec2 vUv;
  
    void main() {

        vec2 uv = vUv*2.0;
        vec2 halfpixel = 0.5 / (resolution.xy / 2.0);
        float offset = 3.0;
    
        vec4 sum = texture(buff_tex, uv) * 4.0;
        sum += texture(buff_tex, uv - halfpixel.xy * offset);
        sum += texture(buff_tex, uv + halfpixel.xy * offset);
        sum += texture(buff_tex, uv + vec2(halfpixel.x, -halfpixel.y) * offset);
        sum += texture(buff_tex, uv - vec2(halfpixel.x, -halfpixel.y) * offset);
    
        gl_FragColor = sum / 8.0;
    }
  
  `
);

extend({BlurDownSampleMaterial})

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'blurDownSampleMaterial': React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial >, ShaderMaterial >;
        }
    }
}

const Interface = () => {

    const {size,gl,scene,camera} = useThree()
    const blurDSMaterialA = useRef<ShaderMaterial | null>(null);
    const blurDSMaterialB = useRef<ShaderMaterial | null>(null);
    const wp = useLoader(TextureLoader, './wallpaper.png')
    const ct = useLoader(TextureLoader, './contact.png')
    
    useEffect(()=>{
        if(blurDSMaterialA.current)
            blurDSMaterialA.current.uniforms.buff_tex.value = wp;
    },[])
    useFrame(({clock})=>{
        const time = clock.getElapsedTime()
        // to do : swap material
    })
    return (
    <>
        <Plane args={[2, 2]}>
            <blurDownSampleMaterial ref={blurDSMaterialA}/>
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