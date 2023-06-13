/* eslint-disable react/no-unescaped-entities */
'use client'
import Image from 'next/image'
import { Effect } from './Effect'
import useState from 'react';

export default function Home() {

  return (
    <main className="flex w-screen h-screen overflow-hidden flex-col items-center justify-between p-4">
      <div className="pb-8 z-10 max-w-5xl items-center justify-between font-mono text-sm lg:flex">
        <p className="text-center fixed left-0 top-0 flex justify-center border-b border-gray-300  from-zinc-200 pb-6 pt-8 dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit lg:static lg:rounded-xl lg:border lg:p-4 ">
          
          <code className="font-mono font-bold">Namedrop animation in R3F</code>
        </p>
      </div>
      <div >
        
        <iframe 
          src="https://ghbtns.com/github-btn.html?user=martinrgb&repo=iOS17_Namedrop_R3F&type=star&count=true&size=large" 
          style={{
            position: 'absolute',
            left:'16px',
            bottom: '16px',
          }}
          width="170" height="30" title="GitHub"></iframe>

        <Effect className="origin-top scale-75" style={{
            width:'297px',
            height:'634px',
            borderRadius: '43px',
            visibility: 'visible',
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            transformOrigin: 'center',
            cursor:'pointer'
        }}/>
        <img
          className='phone-img'
          src="https://raw.githubusercontent.com/MartinRGB/iOS17_Namedrop_R3F/main/public/ip14_pro.png"
          width={876/2}
          height={1774/2}
          alt="Picture of the author"
        />
      </div>
    </main>
  )
}
