'use client'
import React, { createRef, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, createPortal, extend, useFrame, useLoader, useThree, invalidate } from '@react-three/fiber';
import { Plane, shaderMaterial, useFBO } from '@react-three/drei';
import { ShaderMaterial, TextureLoader } from 'three';
import * as THREE from 'three'
import { Stats } from '@react-three/drei'
import { useControls } from 'leva'
import { useSpringValue, animated,SpringValue } from '@react-spring/web'
import { useChain, useSpring, useSpringRef } from 'react-spring';


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

// # the 'pcg' hash method -> https://www.jcgt.org/published/0009/03/02/
const hash_functions=`
#define TWO_PI 6.283185
// https://www.shadertoy.com/view/XlGcRh

// https://www.pcg-random.org/
uint pcg(uint v)
{
	uint state = v * 747796405u + 2891336453u;
	uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
}

uvec2 pcg2d(uvec2 v)
{
    v = v * 1664525u + 1013904223u;

    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;

    v = v ^ (v>>16u);

    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;

    v = v ^ (v>>16u);

    return v;
}

// http://www.jcgt.org/published/0009/03/02/
uvec3 pcg3d(uvec3 v) {

    v = v * 1664525u + 1013904223u;

    v.x += v.y*v.z;
    v.y += v.z*v.x;
    v.z += v.x*v.y;

    v ^= v >> 16u;

    v.x += v.y*v.z;
    v.y += v.z*v.x;
    v.z += v.x*v.y;

    return v;
}


float hash11(float p) {
    return float(pcg(uint(p)))/4294967296.;
}

vec2 hash21(float p) {
    return vec2(pcg2d(uvec2(p, 0)))/4294967296.;
}

vec3 hash33(vec3 p3) {
    return vec3(pcg3d(uvec3(p3)))/4294967296.;
}
`
// ##################################### 2D Transform Shader #####################################
// # noticed that there is a tiny Y-Axis strench in Animation Process
const TextureTransformMaterial = shaderMaterial(
    {
        time: 0,
        buff_tex: null,
        contact_tex:null,
        resolution: [600, 600],
        blurOffset:6.,
        pixelOffset:0.5,
        scale_transform:0.3,
        translation_transform:[0.,0.],
        strench_y_factor:0.,
    },
    prefix_vertex + common_vertex_main,
    prefix_frag + `
        uniform float time;
        uniform vec2 resolution;
        uniform sampler2D buff_tex;
        uniform sampler2D contact_tex;
        uniform vec2 translation_transform;
        uniform float scale_transform;
        uniform float strench_y_factor;

        // # from the book of shaders
        mat2 scale(vec2 _scale){
            return mat2(_scale.x,0.0,
                        0.0,_scale.y);
        }

        // # I didn't use this method,it will cause a border in tblr border
        // # the Three.js's texture wrapping didn't contain 'GL_CLAMP_TO_BORDER'
        // # discussion see here: https://discourse.threejs.org/t/how-clamp-edge-wrapping-a-texture-image/40938

        vec4 roughClampTexture(in vec2 translate,in float scale,in vec2 uv,in float threshold){
            if(vUv.x > ((1.-1./scale)/2. + translate.x + threshold) && vUv.x < ((1.-1./scale)/2. + translate.x + 1./scale - threshold) ){
                if(vUv.y > ((1.-1./scale)/2. + translate.y + threshold) && vUv.y < ((1.-1./scale)/2. + translate.y + 1./scale - threshold) ){
                    vec4 col = texture(contact_tex,vec2(uv.x,uv.y));
                    return col;
                }
            }

            return vec4(0.);
        }

        void main() {
            vec2 uv = vec2(vUv.x,vUv.y/(1.0 + 0.03 * strench_y_factor));
            vec2 wpUV = uv;
            vec2 ctUV = uv;
            float downScale = scale_transform;

            // # 2D translate
            vec2 translate = translation_transform ;
            ctUV -= translate;

            // # 2D scale
            ctUV -= 0.5;
            ctUV = ctUV*scale(vec2(scale_transform));
            ctUV += 0.5;

            //vec4 contactCol = roughClampTexture(translate,scale_transform,ctUV,0.003);
            vec4 contactCol;
            contactCol = texture(contact_tex,ctUV);
            
            vec4 wallpaperCol = texture(buff_tex,vec2(uv.x,uv.y));
            gl_FragColor = mix(wallpaperCol,contactCol,contactCol.a);
        }
    `
)

// ##################################### dual kawase blur downscale sample shader pass #####################################
// # iOS progressive blur ShaderToy:https://www.shadertoy.com/view/DltSzr
// # Noticed that the upScale/downScale Sample's value should related to blurOffset
// # when blurOffset is zero,all upScale & downScale Factor should be 1.;
// # #define sampleScale (1. + blurOffset*0.1)
// # Otherwise when the blurOffset's value is zero,the image is still blurred caused by down/up sample
const BlurDownSampleMaterial = shaderMaterial(
    {
      time: 0,
      buff_tex: null,
      resolution: [600, 600],
      blurOffset:6.,
      pixelOffset:0.5
    },
    prefix_vertex + common_vertex_main,
    prefix_frag + `
        uniform float time;
        uniform vec2 resolution;
        uniform sampler2D buff_tex;
        uniform float blurOffset;
        uniform float pixelOffset;
    
        #define sampleScale (1. + blurOffset*0.1)

        void main() {
            vec2 uv = vUv*sampleScale;
            vec2 halfpixel = pixelOffset / (resolution.xy / sampleScale);
        
            vec4 sum;
            sum = texture(buff_tex, uv) * 4.0;
            sum += texture(buff_tex, uv - halfpixel.xy * blurOffset);
            sum += texture(buff_tex, uv + halfpixel.xy * blurOffset);
            sum += texture(buff_tex, uv + vec2(halfpixel.x, -halfpixel.y) * blurOffset);
            sum += texture(buff_tex, uv - vec2(halfpixel.x, -halfpixel.y) * blurOffset);
        
            gl_FragColor = sum / 8.0;
        }
    `
);

// # dual kawase blur upscale sample shader pass
const BlurUpSampleMaterial = shaderMaterial(

    {
        time: 0,
        buff_tex: null,
        resolution: [600, 600],
        blurOffset:6,
        pixelOffset:0.5
    },
    prefix_vertex + common_vertex_main,
    prefix_frag + `
        uniform float time;
        uniform vec2 resolution;
        uniform sampler2D buff_tex;
        uniform float blurOffset;
        uniform float pixelOffset;

        #define sampleScale (1. + blurOffset*0.1)

        void main() {

            vec2 uv = vUv/sampleScale;
            vec2 halfpixel = pixelOffset / (resolution.xy * sampleScale);
        
            vec4 sum;
            
            sum =  texture(buff_tex, uv +vec2(-halfpixel.x * 2.0, 0.0) * blurOffset);
            sum += texture(buff_tex, uv + vec2(-halfpixel.x, halfpixel.y) * blurOffset) * 2.0;
            sum += texture(buff_tex, uv + vec2(0.0, halfpixel.y * 2.0) * blurOffset);
            sum += texture(buff_tex, uv + vec2(halfpixel.x, halfpixel.y) * blurOffset) * 2.0;
            sum += texture(buff_tex, uv + vec2(halfpixel.x * 2.0, 0.0) * blurOffset);
            sum += texture(buff_tex, uv + vec2(halfpixel.x, -halfpixel.y) * blurOffset) * 2.0;
            sum += texture(buff_tex, uv + vec2(0.0, -halfpixel.y * 2.0) * blurOffset);
            sum += texture(buff_tex, uv + vec2(-halfpixel.x, -halfpixel.y) * blurOffset) * 2.0;
        
            gl_FragColor = sum / 12.0;
        }
    `
)

// ##################################### Ripple(Wave) Shader #####################################
// # the wave shader,the core concept is use distance() function to compare the fragCoord & wave_center,
// # if the conditions are met,we use a pow() function to generate a wave shape in mathematic,then map the function to the clamped distance(as x input)
// # what the iOS namedrop animation's curve should be a 'acceleration curve' in mathematic,but it didnt implementation in this shader
const WaveMaterial =  shaderMaterial(
    {
        time: 0,
        buff_tex: null,
        resolution: [600, 600],
        wavePara:[10.,0.8,0.1],
        waveCenter:[0.5,0.9],
        textureDistortFac:40.,
        waveFactor:0.,
    },
    prefix_vertex + common_vertex_main,
    prefix_frag + `
    uniform float time;
    uniform vec2 resolution;
    uniform sampler2D buff_tex;
    uniform vec3 wavePara;
    uniform vec2 waveCenter;
    uniform float textureDistortFac;
    #define iTime time
    #define iChannel0 buff_tex
    #define iResolution resolution
    uniform float waveFactor;

    float rand(vec2 co){
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    vec4 waveEffect(in vec2 uv){
        //Sawtooth function to pulse from centre.
        // float offset = (iTime- floor(iTime))/iTime;
        // float CurrentTime = (iTime)*(offset);    
        float fac = waveFactor;
        float offset = (fac- floor(fac))/fac;
        float CurrentTime = (fac)*(offset);   

        
        vec3 WaveParams = vec3(10.0, 0.8, 0.1);// distance,height,time
        WaveParams = wavePara;

        float ratio = iResolution.y/iResolution.x;
           
        vec2 WaveCentre = vec2(0.5, 0.9);
        WaveCentre = waveCenter;
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
            texCoord += ((DiffTexCoord * DiffTime) / (CurrentTime * Dist * textureDistortFac));
            Color = texture(iChannel0, texCoord);
            
            //Blow out the color and reduce the effect over time
            Color += (Color * ScaleDiff) / (CurrentTime * Dist * textureDistortFac);

            outputCol = ScaleDiff;
            
        } 

        //return vec4(vec3(outputCol),1.);
        return Color;
    }

    void main() {

        gl_FragColor = waveEffect(vUv);
    }
`);

// ##################################### Particle Shader #####################################
// # compare to standard 'centered grid sampling' & 'staggered grid sampling'
// # this looks like a random sample in different grid 
const ParticleMaterial = shaderMaterial(
    {
        resolution:[600,600],
        time:0,
        buff_tex:null,
        base_color:[0.2,0.3,0.8],
        speed:1,
        burstRange:250,
        length:0.0035,
        particle_amount:500.,
        center:[0.5,0.95],
        pusleFactor:0.,
    },
    prefix_vertex + common_vertex_main,
    hash_functions + prefix_frag + `
    uniform float time;
    uniform vec2 resolution;
    uniform sampler2D buff_tex;
    #define iTime time
    #define iChannel0 buff_tex
    #define iResolution resolution

    uniform vec3 base_color;
    uniform float speed;
    uniform float burstRange;
    uniform float length;
    uniform float particle_amount;
    uniform vec2 center;
    uniform float pusleFactor;

    vec3 particleEffects(in vec2 fragCoord,in vec2 center){
        center = iResolution.xy*center;

        float c0 = 0., c1 = 0.;

        // pulse effect from https://www.shadertoy.com/view/ldycR3
        float fac = 1. + pusleFactor;
        float r = (fac+1.)/2.;
        float a = pow(r, 2.0);
        float b = sin(r * 0.8 - 1.6);
        float c = sin(r - 0.010);
        float s = sin(a - fac * 3.0 + b) * c;
    
        for(float i = 0.; i < particle_amount*s; ++i) {
            float t = speed*iTime + hash11(i);
    
            // # use time generate noise,the parameter is just the seed number
            vec2 v = hash21(i + 50.*floor(t));
            // # from 0 to 1 normalize the noised time
            t = fract(t);
            
            //v = vec2(sqrt(-2.*log(1.-v.x)), 6.283185*v.y);       
            // # polar the coordnates
            // # distance & emit around the center
            v = burstRange*v.x*vec2(cos(v.y*10.), sin(v.y*10.));
    
            vec2 p = center + t*v - fragCoord;
            // # the glow center
            // c0 += 0.1*(1.-t)/(1. + 0.13*dot(p,p));
    
            p = p.yx;
            v = v.yx;
            p = vec2(
                p.x/v.x,
                p.y - p.x/v.x*v.y
            );
            
            float a = abs(p.x) < length ? 50./abs(v.x) : 0.;
            float b0 = max(2. - abs(p.y), 0.);
            //float b1 = 0.2/(1.+0.0001*p.y*p.y);
            c0 += (1.-t)*b0*a;
            //c1 += (1.-t)*b1*a;
            
            // # accumulate particles,
            c0 += (t)*b0*a;
        }
    
        vec3 rgb = c0*base_color;
        //rgb += hash33(vec3(fragCoord,iTime*256.))/512.;
        rgb = pow(rgb, vec3(0.4545));  
        return rgb;      
    }

    void main() {
        vec2 center = vec2(0.5,0.95);
        vec3 particleColor = particleEffects(vUv*iResolution.xy,center);
        gl_FragColor = texture(buff_tex,vUv) + vec4(particleColor,1.);
    }
`
);

// ##################################### Light Shader #####################################
// # Of course I think iOS use a simple way to do this,just a circle blurred png img
// # to the top light area,one way is use SDF functions to create a capsule shape,another way is use texture to map the lighting area.
// # but i didn't use these two ways.
const ProceduralLightMaterial  = shaderMaterial(
    {
        resolution:[600,600],
        time:0,
        buff_tex:null,
        light_distance:200,
        light_expotential_factor:12,
        light_mix_factor:0.5,
        light_center:[0.5,0.5],
        DEPTH:1.,
        depth_offset:[1,1],
        top_light_strength:1.
    },
    prefix_vertex + common_vertex_main,
    prefix_frag + `

    uniform float time;
    uniform vec2 resolution;
    uniform sampler2D buff_tex;
    uniform float light_distance;
    uniform float light_expotential_factor;
    uniform float light_mix_factor;
    uniform vec2 light_center;
    uniform float DEPTH;
    #define iTime time
    #define iChannel0 buff_tex
    #define iResolution resolution
    uniform vec2 depth_offset;
    uniform float top_light_strength;

    // by Nikos Papadopoulos, 4rknova / 2013
    // Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.

    #define ENABLE_LIGHTING
    #define ENABLE_SPECULAR

    //#define OFFSET_X 1
    //#define OFFSET_Y 1
    #define OFFSET_X int(depth_offset.x)
    #define OFFSET_Y int(depth_offset.y)

    vec3 texsample(const int x, const int y, in vec2 fragCoord)
    {
        vec2 uv = fragCoord.xy ;
        uv = (uv + vec2(x, y)) / resolution.xy;
        return texture(iChannel0, uv).xyz;
    }
    
    float luminance(vec3 c)
    {
        return dot(c, vec3(.2126, .7152, .0722));
    }

    vec3 normal(in vec2 fragCoord)
    {
        float R = abs(luminance(texsample( OFFSET_X,0, fragCoord)));
        float L = abs(luminance(texsample(-OFFSET_X,0, fragCoord)));
        float D = abs(luminance(texsample(0, OFFSET_Y, fragCoord)));
        float U = abs(luminance(texsample(0,-OFFSET_Y, fragCoord)));
                    
        float X = (L-R) * .5;
        float Y = (U-D) * .5;

        return normalize(vec3(X, Y, 1. / DEPTH));
    }

    void main()
    {
        vec2 fragCoord = vUv * iResolution.xy;
        vec3 n = normal(fragCoord);

    #ifdef ENABLE_LIGHTING

        //animated_position = vec2(iResolution.x*0.5,iResolution.y*( 0.1 + (cos(iTime) + 1.)/2.)*0.88);
        
        // # lp0 is the top light
        
        vec3 lp0 = vec3(iResolution.x*0.5,iResolution.y*1., light_distance); //iMouse.xy
        vec3 lp = vec3(iResolution.x*light_center.x,iResolution.y*light_center.y, light_distance); //iMouse.xy
        vec3 sp = vec3(fragCoord.xy, 0.);
        
        vec3 c = texsample(0, 0, fragCoord) * dot(n, normalize(lp - sp));
        
        // # add influence of top light
        
        c += texsample(0, 0, fragCoord) * dot(n, normalize(lp0 - sp)) * top_light_strength;

    #ifdef ENABLE_SPECULAR

        // # specular highlights -> https://en.wikibooks.org/wiki/GLSL_Programming/GLUT/Specular_Highlights

        float e = light_expotential_factor;
        vec3 ep = vec3(fragCoord.xy, 200.);
        c += pow(clamp(dot(normalize(reflect(lp - sp, n)), normalize(sp - ep)), 0., 1.), e) /2.;
        c += pow(clamp(dot(normalize(reflect(lp0 - sp, n)), normalize(sp - ep)), 0., 1.), e) * top_light_strength;
    #endif /* ENABLE_SPECULAR */
        
    #else
        vec3 c = n;
        
    #endif /* ENABLE_LIGHTING */
        
        gl_FragColor = mix(texture(buff_tex,vUv),vec4(c, 1),light_mix_factor);
    }
`)

extend({TextureTransformMaterial,BlurDownSampleMaterial,BlurUpSampleMaterial,WaveMaterial,ParticleMaterial,ProceduralLightMaterial})

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'textureTransformMaterial':React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
            'blurDownSampleMaterial': React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
            'blurUpSampleMaterial': React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
            'waveMaterial': React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
            'particleMaterial':React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
            'proceduralLightMaterial':React.DetailedHTMLProps<React.HTMLAttributes<ShaderMaterial>, ShaderMaterial>;
        }
    }
}

interface InterfaceProps {
    isTriggered:boolean
}

const Interface = ({isTriggered}:InterfaceProps) => {

     // #####################################  load image tex #####################################

    const wp = useLoader(TextureLoader, './wallpaper.png')
    const ct = useLoader(TextureLoader, './contact.png')
   
    // #####################################  the renderer's context #####################################

    const {size,gl,scene,camera} = useThree()

    // ##################################### create Material ref for 'uniforms input' #####################################

    const textureTransformMaterialRef = useRef<ShaderMaterial | null>(null)
    const kawaseBlurMaterialRefA = useRef<ShaderMaterial | null>(null)
    const kawaseBlurMaterialRefB = useRef<ShaderMaterial | null>(null)
    const kawaseBlurMaterialRefC = useRef<ShaderMaterial | null>(null)
    const kawaseBlurMaterialRefD = useRef<ShaderMaterial | null>(null)
    const waveMaterialRef = useRef<ShaderMaterial | null>(null)
    const particleMaterialRef = useRef<ShaderMaterial | null>(null)
    const proceduralLightMaterialRef = useRef<ShaderMaterial | null>(null)

    // ##################################### create FBO for different render pass #####################################

    const FBOSettings ={
        format: THREE.RGBAFormat,
        //encoding:THREE.GammaEncoding,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        type: THREE.FloatType,
    };

    const textureTransformFBO = useFBO(size.width,size.height,FBOSettings);
    const kawaseBlurFBOA = useFBO(size.width,size.height,FBOSettings);
    const kawaseBlurFBOB = useFBO(size.width,size.height,FBOSettings);
    const kawaseBlurFBOC = useFBO(size.width,size.height,FBOSettings);
    const kawaseBlurFBOD = useFBO(size.width,size.height,FBOSettings);
    const waveFBO = useFBO(size.width,size.height,FBOSettings)
    const lightFBO = useFBO(size.width,size.height,FBOSettings)

    // ##################################### create scenes for different FBOS #####################################

    const [textureTransformScene,kawaseBlurSceneA,kawaseBlurSceneB,kawaseBlurSceneC,kawaseBlurSceneD,waveScene,lightScene] = useMemo(() => {
        const textureTransformScene = new THREE.Scene()
        const kawaseBlurSceneA = new THREE.Scene()
        const kawaseBlurSceneB = new THREE.Scene()
        const kawaseBlurSceneC = new THREE.Scene()
        const kawaseBlurSceneD = new THREE.Scene()
        const waveScene = new THREE.Scene()
        const lightScene = new THREE.Scene()
        
        return [textureTransformScene,kawaseBlurSceneA,kawaseBlurSceneB,kawaseBlurSceneC,kawaseBlurSceneD,waveScene,lightScene]
    }, []) 

    // ##################################### Leva GUI part #####################################

    const {scale_transform,translation_transform,strench_y_factor} = useControls('Transform',{
        scale_transform:{
            lable:'scale',
            value: 0.3,
            min: 0,
            max: 10,
            step:0.001,
            onChange: (v) => {
                if(textureTransformMaterialRef.current){
                    textureTransformMaterialRef.current.uniforms.scale_transform.value =  1./v;
                }
            }
        },

        strench_y_factor:{
            label:'strench y factor',
            value:0.,
            min:0.,
            max:10.,
            step:0.01,
            onChange: (v) => {
                if(textureTransformMaterialRef.current){
                    textureTransformMaterialRef.current.uniforms.strench_y_factor.value =  v;
                }
            }
        
        },

        translation_transform:{
            lable:'transform',
            value: {
                x:0.,
                y:3.0
            },
            min: -10,
            max: 10,
            step:0.001,
            onChange: (v) => {
                if(textureTransformMaterialRef.current){
                    textureTransformMaterialRef.current.uniforms.translation_transform.value =  v;
                }
            }
        },


    })

    const { blurOffset,pixelOffset } = useControls('Blur',{
        blurOffset: {
          label: 'blur offset',
          value: 0.,
          min: 0,
          max: 100,
          step: 0.01,
          onChange: (v) => {
            if(kawaseBlurMaterialRefA.current){
                kawaseBlurMaterialRefA.current.uniforms.blurOffset.value =  v;
            }
            if(kawaseBlurMaterialRefB.current){
                kawaseBlurMaterialRefB.current.uniforms.blurOffset.value =  v;
            }
            if(kawaseBlurMaterialRefC.current){
                kawaseBlurMaterialRefC.current.uniforms.blurOffset.value =  v;
            }
            if(kawaseBlurMaterialRefD.current){
                kawaseBlurMaterialRefD.current.uniforms.blurOffset.value =  v;
            }
          }
        },
    
        pixelOffset: {
          label: 'pixel offset',
          value: 0.5,
          min: 0,
          max: 10.,
          step: 0.01,
          onChange: (v) => {
            if(kawaseBlurMaterialRefA.current){
                kawaseBlurMaterialRefA.current.uniforms.pixelOffset.value =  v;
            }
            if(kawaseBlurMaterialRefB.current){
                kawaseBlurMaterialRefB.current.uniforms.pixelOffset.value =  v;
            }
            if(kawaseBlurMaterialRefC.current){
                kawaseBlurMaterialRefC.current.uniforms.pixelOffset.value =  v;
            }
            if(kawaseBlurMaterialRefD.current){
                kawaseBlurMaterialRefD.current.uniforms.pixelOffset.value =  v;
            }
          }
        },
    })

    const {wavePara,waveCenter,textureDistortFactor,waveFactor} = useControls('Wave',{

        waveFactor:{
            label:'wave animation factor',
            value:0.,
            min:0.,
            max:10.,
            step:0.01,
            onChange:(v)=>{
                if(waveMaterialRef.current){
                    waveMaterialRef.current.uniforms.waveFactor.value = v;
                }
            }
        },


        wavePara: {
            label: 'wave parameters',
            value: {
                x:10.,
                y:0.8,
                z:0.1
            },
            step: 0.01,
            onChange: (v) => {
                if(waveMaterialRef.current && waveMaterialRef.current.uniforms.wavePara && waveFBO){
                    waveMaterialRef.current.uniforms.wavePara.value = [v.x,v.y,v.z];
                }
            }
        },

          waveCenter:{
            label:'wave center',
            value:{
                x:0.5,
                y:0.9
            },
            step:0.01,
            onChange:(v) =>{
                if(waveMaterialRef.current){
                    waveMaterialRef.current.uniforms.waveCenter.value = new THREE.Vector2(v.x,v.y);
                }

            }

          },

          textureDistortFactor:{
            label:'distortion factor',
            value:40,
            min:0.00001,
            max:1000,
            step:0.001,
            onChange:(v)=>{
                if(waveMaterialRef.current){
                    waveMaterialRef.current.uniforms.textureDistortFac.value = v;
                }
            }
          }
    })

    const {base_color,speed,burstRange,length,particle_amount,center,pusleFactor} = useControls('Particle',{
        
        base_color:{
            label:'base color',
            value: {
                r:0.2*255,
                g:0.3*255,
                b:0.8*255,
            },
            onChange:(v)=>{
                if(particleMaterialRef.current){
                    particleMaterialRef.current.uniforms.base_color.value = [v.r/255.,v.g/255.,v.b/255];
                }
            }
        },
        pusleFactor:{
            label:'pusle animation factor',
            value: 0.,
            min:0.,
            max:10.,
            step:0.01,
            onChange:(v)=>{
                if(particleMaterialRef.current){
                    particleMaterialRef.current.uniforms.pusleFactor.value = v;
                }
            }
        },

        length:{
            label:'particle size',
            value: 35.,
            min:0.,
            max:10000.,
            step:0.01,
            onChange:(v)=>{
                if(particleMaterialRef.current){
                    particleMaterialRef.current.uniforms.length.value = v/10000;
                }
            }
        },

        speed:{
            label:'particle speed',
            value: 1.,
            min:0.,
            max:100.,
            step:0.01,
            onChange:(v)=>{
                if(particleMaterialRef.current){
                    particleMaterialRef.current.uniforms.speed.value = v;
                }
            }
        },

        burstRange:{
            label:'burst range',
            value: 250.,
            min:0.,
            max:1000.,
            step:0.01,
            onChange:(v)=>{
                if(particleMaterialRef.current){
                    particleMaterialRef.current.uniforms.burstRange.value = v;
                }
            }
        },

        particle_amount:{
            label:'particle number',
            value: 500.,
            min:0.,
            max:5000,
            step:1,
            onChange:(v)=>{
                if(particleMaterialRef.current){
                    particleMaterialRef.current.uniforms.particle_amount.value = v;
                }
            }
        },

        center:{
            label:'burst center',
            value: {
                x:0.5,
                y:0.95
            },
            min:0.,
            max:1,
            step:0.001,
            onChange:(v)=>{
                if(particleMaterialRef.current){
                    particleMaterialRef.current.uniforms.center.value = [v.x,v.y];
                }
            }
        },

    })

    const {light_distance,light_expotential_factor,light_mix_factor,light_center,top_light_strength} = useControls('Light',{

        light_distance:{
            label:'light distance',
            value: 200.,
            min:0.,
            max:5000.,
            step:0.01,
            onChange:(v)=>{
                if(proceduralLightMaterialRef.current){
                    proceduralLightMaterialRef.current.uniforms.light_distance.value = v;
                }
            }
        },

        top_light_strength:{
            label:'top light strength',
            value: 0.,
            min:0.,
            max:1.,
            step:0.01,
            onChange:(v)=>{
                if(proceduralLightMaterialRef.current){
                    proceduralLightMaterialRef.current.uniforms.top_light_strength.value = v;
                }
            }
        },

        light_expotential_factor:{
            label:'light exp factor',
            value: 12.,
            min:0.,
            max:100.,
            step:0.01,
            onChange:(v)=>{
                if(proceduralLightMaterialRef.current){
                    proceduralLightMaterialRef.current.uniforms.light_expotential_factor.value = v;
                }
            }
        },

        light_mix_factor:{
            label:'light mix factor',
            value: 0.5,
            min:0.,
            max:1.,
            step:0.01,
            onChange:(v)=>{
                if(proceduralLightMaterialRef.current){
                    proceduralLightMaterialRef.current.uniforms.light_mix_factor.value = v;
                }
            }
        },

        light_center:{
            label:'light center',
            value: {
                x:0.5,
                y:0.5,
            },
            min:0.,
            max:1.,
            step:0.01,
            onChange:(v)=>{
                if(proceduralLightMaterialRef.current){
                    proceduralLightMaterialRef.current.uniforms.light_center.value = [v.x,v.y];
                }
            }
        },

        depth_offset:{
            label:'depth offset',
            value:{
                x:1,
                y:1,
            },
            min:0,
            max:100,
            step:1,
            onChange:(v)=>{
                if(proceduralLightMaterialRef.current){
                    proceduralLightMaterialRef.current.uniforms.depth_offset.value = [v.x,v.y];
                }
            }
        },

        light_depth:{
            label:'material depth',
            value:1,
            min:0.01,
            max:100.,
            step:0.01,
            onChange:(v)=>{
                if(proceduralLightMaterialRef.current){
                    proceduralLightMaterialRef.current.uniforms.DEPTH.value = v;
                }
            }
        }
    })

    // ##################################### add resolution value into each buffers #####################################

    useEffect(()=>{
        if(kawaseBlurMaterialRefA.current){
            kawaseBlurMaterialRefA.current.uniforms.resolution.value = new THREE.Vector2(size.width,size.height);
        }
        if(kawaseBlurMaterialRefB.current){
            kawaseBlurMaterialRefB.current.uniforms.resolution.value = new THREE.Vector2(size.width,size.height);
        }
        if(kawaseBlurMaterialRefC.current){
            kawaseBlurMaterialRefC.current.uniforms.resolution.value = new THREE.Vector2(size.width,size.height);
        }
        if(kawaseBlurMaterialRefD.current){
            kawaseBlurMaterialRefD.current.uniforms.resolution.value = new THREE.Vector2(size.width,size.height);
        }

        if(waveMaterialRef.current){
            waveMaterialRef.current.uniforms.resolution.value = new THREE.Vector2(size.width,size.height);
        }

        if(particleMaterialRef.current){
            particleMaterialRef.current.uniforms.resolution.value = new THREE.Vector2(size.width,size.height);
        }

        if(proceduralLightMaterialRef.current){
            proceduralLightMaterialRef.current.uniforms.resolution.value = new THREE.Vector2(size.width,size.height);
        }

    },[])
    
    // ##################################### ShaderPass: #####################################
    // # 2D Transform -> Blur -> Wave -> Light -> Particle
    useFrame(({clock})=>{
        const time = clock.getElapsedTime()

        if(textureTransformMaterialRef.current){
            textureTransformMaterialRef.current.uniforms.buff_tex.value = wp;
            textureTransformMaterialRef.current.uniforms.contact_tex.value = ct;
            textureTransformMaterialRef.current.uniforms.time.value = time;

            // KawaseBlur Pass 1 Buffer
            gl.setRenderTarget(textureTransformFBO);
            gl.render(textureTransformScene,camera)
            gl.setRenderTarget(null)
        }

        // DownSample - Pass 1
        if(kawaseBlurMaterialRefA.current){
            kawaseBlurMaterialRefA.current.uniforms.buff_tex.value = textureTransformFBO.texture;
            kawaseBlurMaterialRefA.current.uniforms.time.value = time;

            // KawaseBlur Pass 1 Buffer
            gl.setRenderTarget(kawaseBlurFBOA);
            gl.render(kawaseBlurSceneA,camera)
            gl.setRenderTarget(null)
        }
            

        // DownSample - Pass 2
        if(kawaseBlurMaterialRefB.current){
            kawaseBlurMaterialRefB.current.uniforms.buff_tex.value = kawaseBlurFBOA.texture
            kawaseBlurMaterialRefB.current.uniforms.time.value = time;

            // KawaseBlur Pass 2 Buffer
            gl.setRenderTarget(kawaseBlurFBOB);
            gl.render(kawaseBlurSceneB,camera)
            gl.setRenderTarget(null)
        }

        // UpSample - Pass 3
        if(kawaseBlurMaterialRefC.current){
            kawaseBlurMaterialRefC.current.uniforms.buff_tex.value = kawaseBlurFBOB.texture
            kawaseBlurMaterialRefC.current.uniforms.time.value = time;

            // KawaseBlur Pass 3 Buffer
            gl.setRenderTarget(kawaseBlurFBOC);
            gl.render(kawaseBlurSceneC,camera)
            gl.setRenderTarget(null)
        }

        // UpSample - Pass 4        
        if(kawaseBlurMaterialRefD.current){
            kawaseBlurMaterialRefD.current.uniforms.buff_tex.value = kawaseBlurFBOC.texture
            kawaseBlurMaterialRefD.current.uniforms.time.value = time;

            // KawaseBlur Pass 4 Buffer
            gl.setRenderTarget(kawaseBlurFBOD);
            gl.render(kawaseBlurSceneD,camera)
            gl.setRenderTarget(null)
        }

        // WaveMaterial Pass
        if(waveMaterialRef.current){
            waveMaterialRef.current.uniforms.buff_tex.value = kawaseBlurFBOD.texture
            waveMaterialRef.current.uniforms.time.value = time;

            // Wave Pass Buffer
            gl.setRenderTarget(waveFBO);
            gl.render(waveScene,camera)
            gl.setRenderTarget(null)
        }

        // Procedural Lighting Pass
        if(proceduralLightMaterialRef.current){
            proceduralLightMaterialRef.current.uniforms.buff_tex.value = waveFBO.texture; //lightFBO.texture
            proceduralLightMaterialRef.current.uniforms.time.value = time;
            
            // Light Pass Buffer
            gl.setRenderTarget(lightFBO);
            gl.render(lightScene,camera)
            gl.setRenderTarget(null)
        }

        // Particle Pass
        if(particleMaterialRef.current){
            particleMaterialRef.current.uniforms.buff_tex.value = lightFBO.texture
            particleMaterialRef.current.uniforms.time.value = time;
        }
    })

    // ##################################### React-Spring Animation Part: #####################################

    // light [back] animation
    const [lightFade, setLightFade] = useSpring(() => ({
        lightMixFactor:0.6,
        config:{mass:1,friction:35,tension:200},
        onChange: (v) => {
                if(proceduralLightMaterialRef.current){
                    proceduralLightMaterialRef.current.uniforms.light_mix_factor.value =  v.value.lightMixFactor;
                }
        },
        immediate:isTriggered,
    }))

    // light animation
    const [lightPropsGo, springApiLightGo] = useSpring(() => ({
        from: { 
            lightCenter:[0.5,0.],
            lightMixFactor:0.,
            topLightStrength:0.},
        to: {
            lightCenter: isTriggered ? [0.5,0.95]:[0.5,0.],
            lightMixFactor: isTriggered? 0.7:0.,
            topLightStrength: isTriggered? 1.:0.,
        },
        config:{mass:1,friction:40,tension:200},
        onChange: (v) => {
            if(proceduralLightMaterialRef.current){
                proceduralLightMaterialRef.current.uniforms.light_center.value =  v.value.lightCenter;
                proceduralLightMaterialRef.current.uniforms.top_light_strength.value =  v.value.topLightStrength;
                if(v.value.lightMixFactor < 0.6){
                    proceduralLightMaterialRef.current.uniforms.top_light_strength.value =  v.value.topLightStrength;
                }
                else{
                    setLightFade({lightMixFactor:0.});
                }
            }

        },
        immediate:!isTriggered,
    }),[isTriggered])

    // # strench Y animation
    const [texStrenchYGo, springApiTexStrenchYGo] = useSpring(() => ({
        from: { strench_y_factor:0.},
        to: {
            strench_y_factor: isTriggered? 1.:0.,
        },
        config:{mass:1,friction:40,tension:200},
        onChange: (v) => {

            if(textureTransformMaterialRef.current){
                textureTransformMaterialRef.current.uniforms.strench_y_factor.value =  v.value.strench_y_factor;
            }
            
        },
        immediate:!isTriggered,
    }),[isTriggered])

    // # blur [back] animation
    const [blurFade, setBlurFade] = useSpring(() => ({
        blurOffset:5.5,
        config:{mass:1,friction:35,tension:200},
        onChange: (v) => {
            if( kawaseBlurMaterialRefA.current && 
                kawaseBlurMaterialRefB.current &&
                kawaseBlurMaterialRefC.current &&
                kawaseBlurMaterialRefD.current
            ){
                kawaseBlurMaterialRefA.current.uniforms.blurOffset.value = v.value.blurOffset;
                kawaseBlurMaterialRefB.current.uniforms.blurOffset.value = v.value.blurOffset;
                kawaseBlurMaterialRefC.current.uniforms.blurOffset.value = v.value.blurOffset;
                kawaseBlurMaterialRefD.current.uniforms.blurOffset.value = v.value.blurOffset;
            }
        },
    }))

    // # blur animation
    const [blurPropsGo, springApiBlurGo] = useSpring(() => ({
        from: { 
            blurOffset:0.,
        },
        to: {
            blurOffset: isTriggered ? 6.:0.,
        },
        config:{ mass:1,friction:40,tension:80},
        onChange: (v) => {
            if( kawaseBlurMaterialRefA.current && 
                kawaseBlurMaterialRefB.current &&
                kawaseBlurMaterialRefC.current &&
                kawaseBlurMaterialRefD.current
            ){
                if(v.value.blurOffset < 5.5){
                    kawaseBlurMaterialRefA.current.uniforms.blurOffset.value = v.value.blurOffset;
                    kawaseBlurMaterialRefB.current.uniforms.blurOffset.value = v.value.blurOffset;
                    kawaseBlurMaterialRefC.current.uniforms.blurOffset.value = v.value.blurOffset;
                    kawaseBlurMaterialRefD.current.uniforms.blurOffset.value = v.value.blurOffset;
                }
                else{
                    setBlurFade({blurOffset:0.});
                    setStrenchFade({strench_y_factor:0.});

                }
            }
        },
        dealy:isTriggered?300:0,
        immediate:!isTriggered,
    }),[isTriggered])

     // # particle & wave pulse animation
    const [pulseProps, springApiPulse] = useSpring(() => ({
        from: { 
            particlePulseFactor:0.,
            wavePulseFactor:0.,
            particle_amount:500.,
        },
        to: {
            particlePulseFactor: isTriggered ? 5.3:0.,
            wavePulseFactor:isTriggered?0.97:0.,
            particle_amount:isTriggered?0.:500.,
        },
        config:{ mass:1,friction:40,tension:90},
        onChange: (v) => {
            if(particleMaterialRef.current){
                particleMaterialRef.current.uniforms.pusleFactor.value =  v.value.particlePulseFactor;
                particleMaterialRef.current.uniforms.particle_amount.value =  v.value.particle_amount;
            }

            if(waveMaterialRef.current){
                waveMaterialRef.current.uniforms.waveFactor.value = v.value.wavePulseFactor;
            }
        },
        delay:isTriggered?450:0,
        immediate:!isTriggered,
    }),[isTriggered])

    // # strench Y [back] animation
    const [strenchFade, setStrenchFade] = useSpring(() => ({
        strench_y_factor:1.,
        config:{mass:1,friction:35,tension:200},
        onChange: (v) => {
                if(textureTransformMaterialRef.current){
                    textureTransformMaterialRef.current.uniforms.strench_y_factor.value =  v.value.strench_y_factor;
                }
        },
    }))

    // # scale animation
    const [scaleProps, springApiScale] = useSpring(() => ({
        from: { scaleTransform:0.3},
        to: {
          scaleTransform: isTriggered ? 1.04:0.3,
        },
        config:{mass:1,friction:35,tension:150},
        onChange: (v) => {
            if(textureTransformMaterialRef.current){
                textureTransformMaterialRef.current.uniforms.scale_transform.value =  1./v.value.scaleTransform;
            }
        },
        delay:isTriggered?650:0,
        immediate:!isTriggered,
    }),[isTriggered])

    // # translation animation
    const [translationProps, springApiTranslation] = useSpring(() => ({
        from: { translationTransform:[0.,3.]},
        to: {translationTransform: isTriggered ? [0.,0.]:[0.,3.],},
        config:{ mass:1,friction:40,tension:250},
        onChange: (v) => {
            if(textureTransformMaterialRef.current){
                textureTransformMaterialRef.current.uniforms.translation_transform.value =  v.value.translationTransform;
            }
        },
        delay:isTriggered?300:0,
        immediate:!isTriggered,
    }),[isTriggered])

    // ### recovery the state of the animation ###
    useEffect(()=>{
        if(isTriggered){
            setLightFade({lightMixFactor:0.6});
            setBlurFade({blurOffset:5.});
            setStrenchFade({strench_y_factor:1.});
        }
    },[isTriggered])


    // # createPortal ->  scene is inside a React createPortal and is completely isolated, you can have your own cameras in there
    // # check https://github.com/pmndrs/drei
    return (
    <>
        {createPortal(<>
          <Plane args={[2, 2]}>
             <textureTransformMaterial ref={textureTransformMaterialRef}  />
          </Plane>
        </>, textureTransformScene)}

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

        {createPortal(<>
          <Plane args={[2, 2]}>
             <waveMaterial ref={waveMaterialRef}  />
          </Plane>
        </>, waveScene)}

        {createPortal(<>

            <Plane args={[2, 2]}>
                <proceduralLightMaterial ref={proceduralLightMaterialRef}  />
            </Plane>
        </>, lightScene)}

        <Plane args={[2, 2]}>
             <particleMaterial ref={particleMaterialRef}  />
        </Plane>
        
    </>
    )

}

export const Effect = (props:any) =>{

  const [isTriggered,setIsTriggered] = useState(false);

  return(
    <>
        <Canvas 
        onClick={()=>{
            setIsTriggered(!isTriggered);
        }}
        className={props.className} style={{...props.style}}>
            <ambientLight />
            <Interface isTriggered={isTriggered} />
            <Stats />
        </Canvas>
    </>

  )
}