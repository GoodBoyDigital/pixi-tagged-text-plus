import TaggedText from 'pixi-tagged-text-plus'
import React, { useEffect } from 'react'

import { createDemo } from './helpers'

const Page: React.FC = () => {
  useEffect(() => {
    const basicText = `
      Let's make some 123
      <ml>multiline</ml>
      and <ms>multistyle</ms> text for
      <pixi>Pixi.js!</pixi>
    `

    const basicStyle = {
      default: {
        fontSize: '24px',
        fill: '#cccccc',
        align: 'center',
      },
      ml: {
        fontStyle: 'italic',
        color: '#ff8888',
        fontSize: '40px',
      },
      ms: {
        fontWeight: 'bold',
        fill: '#4488ff',
        fontSize: '40px',
      },
      pixi: {
        fontSize: '64px',
        fill: '#efefef',
      },
    } as const

    const basic = new TaggedText(basicText, basicStyle, { })

    createDemo('basic', basic)
  }, [])

  return (
    <div className='example'>
      <div className='code'>
        <h2>Basics</h2>
      </div>

      <div className='pixi' id='basic' />
    </div>
  )
}

export default Page