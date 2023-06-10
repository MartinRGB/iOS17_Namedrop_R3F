/* eslint-disable react/no-unescaped-entities */
'use client'
import Image from 'next/image'
import { Effect } from './Effect'
import { Stats } from "https://cdn.skypack.dev/@react-three/drei/Stats";

export default function Home() {
  return (
    <main className="flex w-screen h-screen overflow-hidden flex-col items-center justify-between p-4">
      <div className="pb-8 z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex">
        <p className="text-center w-full fixed left-0 top-0 flex justify-center border-b border-gray-300  from-zinc-200 pb-6 pt-8 dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit lg:static lg:rounded-xl lg:border lg:p-4 ">
          Let's recreate namedrop animation in&nbsp;
          <code className="font-mono font-bold">WWDC 2023</code>
        </p>
      </div>
      <div>
      <Effect className="origin-top scale-75" style={{
          width:'297px',
          height:'634px',
          borderRadius: '43px',
          visibility: 'visible',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          transformOrigin: 'center'
      }}/>
      <Image
        className='phone-img'
        src="/ip14_pro.png"
        width={876/2}
        height={1774/2}
        alt="Picture of the author"
      />
      </div>
    </main>
  )
}
