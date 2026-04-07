// ════════════════════════════════════════════════════════════════════════════
// CoreCenter.tsx — Ponto central de energia do Nucleus
// MUITO compacto — apenas o core brilhante, NÃO uma esfera gigante
// ════════════════════════════════════════════════════════════════════════════
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CORE_CENTER, NUCLEUS_COLORS, type JamesCoreState } from './jamesSceneConfig'

interface CoreCenterProps {
  state: JamesCoreState
  intensity: number
}

// ── Simplex noise (compact GLSL) ──────────────────────────────────────────
const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */`
${NOISE_GLSL}

uniform float uTime;
uniform float uIntensity;
uniform float uPulseSpeed;
uniform vec3 uCoreColor;
uniform vec3 uGlowColor;
varying vec2 vUv;

void main() {
  vec2 c = vUv - 0.5;
  float dist = length(c);
  
  // Discard anything far from center — core is TINY
  if (dist > 0.42) discard;
  
  // Bright hot center — very small and concentrated
  float hotspot = smoothstep(0.08, 0.0, dist);
  hotspot = pow(hotspot, 1.5);
  
  // Inner glow — extends slightly beyond hotspot
  float innerGlow = smoothstep(0.18, 0.0, dist) * 0.6;
  
  // Subtle concentric rings emanating from center (depth effect)
  float rings = sin(dist * 60.0 - uTime * 2.0) * 0.5 + 0.5;
  rings *= smoothstep(0.35, 0.05, dist) * 0.2;
  
  // Organic noise at the core
  float n = snoise(vec3(c * 12.0, uTime * 0.5)) * 0.5 + 0.5;
  
  // Pulse
  float pulse = sin(uTime * uPulseSpeed) * 0.12 + 0.88;
  
  // Energy tendrils — subtle rays from center
  float angle = atan(c.y, c.x);
  float rays = pow(abs(sin(angle * 6.0 + uTime * 1.5)), 8.0);
  rays *= smoothstep(0.35, 0.03, dist) * 0.15;
  
  // Compose
  float energy = (hotspot + innerGlow + rings * n + rays) * pulse * uIntensity;
  
  // Color: white at absolute center, blue glow outside
  vec3 color = mix(uGlowColor, uCoreColor, hotspot);
  color *= energy;
  
  // Alpha — tight falloff
  float alpha = smoothstep(0.4, 0.0, dist) * uIntensity;
  alpha *= pulse;
  
  gl_FragColor = vec4(color, alpha);
}
`

export default function CoreCenter({ state, intensity }: CoreCenterProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null)

  const uniforms = useMemo(() => ({
    uTime:       { value: 0 },
    uIntensity:  { value: intensity },
    uPulseSpeed: { value: CORE_CENTER.pulseSpeed[state] },
    uCoreColor:  { value: new THREE.Color(NUCLEUS_COLORS.coreInner) },
    uGlowColor:  { value: new THREE.Color(NUCLEUS_COLORS.coreGlow) },
  }), [])

  const targetIntensity = useRef(intensity)
  const targetPulse = useRef(CORE_CENTER.pulseSpeed[state])
  const targetColor = useRef(new THREE.Color(NUCLEUS_COLORS.coreGlow))

  targetIntensity.current = intensity
  targetPulse.current = CORE_CENTER.pulseSpeed[state]

  const stateColor = state === 'listening' ? NUCLEUS_COLORS.listeningTint
    : state === 'processing' ? NUCLEUS_COLORS.processingTint
    : state === 'speaking' ? NUCLEUS_COLORS.speakingTint
    : state === 'alert' ? NUCLEUS_COLORS.alertTint
    : NUCLEUS_COLORS.coreGlow
  targetColor.current.set(stateColor)

  useFrame((_, delta) => {
    if (!matRef.current) return
    const u = matRef.current.uniforms
    u.uTime.value += delta
    u.uIntensity.value += (targetIntensity.current - u.uIntensity.value) * delta * 3
    u.uPulseSpeed.value += (targetPulse.current - u.uPulseSpeed.value) * delta * 4
    ;(u.uGlowColor.value as THREE.Color).lerp(targetColor.current, delta * 3)
  })

  return (
    <group>
      {/* Core energy — SMALL and concentrated */}
      <mesh>
        <planeGeometry args={[0.6, 0.6, 1, 1]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Subtle ambient halo — barely visible, creates depth */}
      <mesh position={[0, 0, -0.3]}>
        <planeGeometry args={[1.2, 1.2, 1, 1]} />
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={{
            uTime:       { value: 0 },
            uIntensity:  { value: intensity * 0.06 },
            uPulseSpeed: { value: 0.3 },
            uCoreColor:  { value: new THREE.Color(NUCLEUS_COLORS.coreInner) },
            uGlowColor:  { value: new THREE.Color(NUCLEUS_COLORS.coreGlow) },
          }}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}
