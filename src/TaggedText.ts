/* eslint-disable no-console */
import * as PIXI from 'pixi.js'

import {
  DEFAULT_KEY,
  IMG_REFERENCE_PROPERTY,
  isNewlineToken,
  isNotWhitespaceToken,
  isSpriteSource,
  isSpriteToken,
  isTextToken,
  isTextureSource,
  isWhitespaceToken,
} from './types'
import { EMOJI_TAG, parseTagsNew, removeTags } from './tags'
import {
  combineAllStyles,
  convertUnsupportedAlignment,
  getStyleForTag as getStyleForTagExt,
  mapTagsToStyles,
} from './style'
import { calculateTokens, getBoundsNested } from './layout'
import { capitalize } from './stringUtil'
import { fontSizeStringToNumber } from './pixiUtils'
import { logWarning as _logWarning } from './errorMessaging'
import DEFAULT_STYLE from './defaultStyle'
import DEFAULT_OPTIONS from './defaultOptions'

import type {
  AttributesList,
  ImageMap,
  ImageSourceMap,
  ParagraphToken,
  PixiTextTypes,
  Point,
  SegmentToken,
  TagWithAttributes,
  TaggedTextOptions,
  TextDecorationMetrics,
  TextSegmentToken,
  TextStyleExtended,
  TextStyleSet,
} from './types'

// TODO: make customizable
const DEBUG = {
  WORD_STROKE_COLOR: 0xFFCCCC,
  WORD_FILL_COLOR: 0xEEEEEE,
  TEXT_FIELD_STROKE_COLOR: 0xFF00FF,
  WHITESPACE_COLOR: 0xCCCCCC,
  WHITESPACE_STROKE_COLOR: 0xAAAAAA,
  BASELINE_COLOR: 0xFFFF99,
  LINE_COLOR: 0xFFFF00,
  OUTLINE_COLOR: 0xFFCCCC,
  OUTLINE_SHADOW_COLOR: 0x000000,
  TEXT_STYLE: {
    fontFamily: 'courier',
    fontSize: 10,
    fill: 0xFFFFFF,
    dropShadow: true,
  },
}

const DEFAULT_STYLE_SET = { default: DEFAULT_STYLE }
Object.freeze(DEFAULT_STYLE_SET)
Object.freeze(DEFAULT_STYLE)

const DEFAULT_DESTROY_OPTIONS = {
  children: true,
  texture: true,
} satisfies PIXI.DestroyOptions

export default class TaggedText<
  TextType extends PixiTextTypes = PIXI.Text,
> extends PIXI.Sprite {
  public static get defaultStyles(): TextStyleSet {
    return DEFAULT_STYLE_SET
  }

  public static get defaultOptions(): TaggedTextOptions {
    return DEFAULT_OPTIONS
  }

  /** Settings for the TaggedText component. */
  private _options: TaggedTextOptions
  public get options(): TaggedTextOptions {
    return this._options
  }

  private _needsUpdate = true
  public get needsUpdate(): boolean {
    return this._needsUpdate
  }

  private _needsDraw = true
  public get needsDraw(): boolean {
    return this._needsDraw
  }

  private _tokens: ParagraphToken = []
  /**
   * Tokens representing parsed out and styled tagged text. This is generated by update.
   * They contain all the information needed to render the text fields and other children in your component.
   */
  public get tokens(): ParagraphToken {
    return this._tokens
  }

  public get tokensFlat(): SegmentToken[] {
    return this._tokens.flat(3)
  }

  private _text = ''
  public get text(): string {
    return this._text
  }

  /**
   * Alternative implicit setter for text. Always uses default for skipUpdate.
   */
  public set text(text: string) {
    this.setText(text)
  }

  /**
   * Setter for text that allows you to override the default for skipping the update.
   * @param text Text to add to component with (optional) tags.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the text.
   * When true, setText() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public setText(text: string, skipUpdate?: boolean): void {
    if (text === this._text && this._needsUpdate === false) {
      return
    }
    this._text = text
    this._needsUpdate = true
    this.updateIfShould(skipUpdate)
  }

  /**
   * Returns the text content with all tags stripped out.
   */
  public get untaggedText(): string {
    return removeTags(this.text)
  }

  private _tagStyles: TextStyleSet = {}
  public get tagStyles(): TextStyleSet {
    return this._tagStyles
  }

  /**
   * Alternative implicit setter for tagStyles. Always uses default for skipUpdate.
   */
  public set tagStyles(styles: TextStyleSet) {
    this.setTagStyles(styles)
  }

  /**
   * Setter for tagStyles.
   * @param styles Object with strings for keys representing tag names, mapped to style objects.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the styles.
   * When true, setTagStyles() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public setTagStyles(styles: TextStyleSet, skipUpdate?: boolean): void {
    Object.entries(styles).forEach(([tag, style]) =>
      this.setStyleForTag(tag, style, true),
    )
    // TODO: add a way to test for identical styles to prevent unnecessary updates.
    this._needsUpdate = true
    this.updateIfShould(skipUpdate)
  }

  public getStyleForTag(
    tag: string,
    attributes: AttributesList = {},
  ): TextStyleExtended | undefined {
    return getStyleForTagExt(tag, this.tagStyles, attributes)
  }

  public getStyleForTags(tags: TagWithAttributes[]): TextStyleExtended {
    const styles = tags.map(({ tagName, attributes }) =>
      this.getStyleForTag(tagName, attributes),
    )
    return combineAllStyles(styles)
  }

  /**
   * Set a style to be used by a single tag.
   * @param tag Name of the tag to set style for
   * @param styles Style object to assign to the tag.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the styles.
   * When true, setStyleForTag() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public setStyleForTag(
    tag: string,
    styles: TextStyleExtended,
    skipUpdate?: boolean,
  ): boolean {
    this.tagStyles[tag] = styles

    // TODO: warn user when trying to set styles on a tag that doesn't support it...
    // e.g. wordWrapWidth on a styel other than default.

    // Override some settings on default styles.
    if (tag === DEFAULT_KEY && this.defaultStyle[IMG_REFERENCE_PROPERTY]) {
      // prevents accidentally setting all text to images.
      this.logWarning(
        `${IMG_REFERENCE_PROPERTY}-on-default`,
        `Style "${IMG_REFERENCE_PROPERTY}" can not be set on the "${DEFAULT_KEY}" style because it will add images to EVERY tag!`,
      )
      this.defaultStyle[IMG_REFERENCE_PROPERTY] = undefined
    }
    // TODO: add a way to test for identical styles to prevent unnecessary updates.
    this._needsUpdate = true
    this.updateIfShould(skipUpdate)

    return true
  }

  /**
   * Removes a style associated with a tag. Note, inline attributes are not affected.
   * @param tag Name of the tag to delete the style of.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the styles.
   * When true, removeStylesForTag() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public removeStylesForTag(tag: string, skipUpdate?: boolean): boolean {
    if (tag in this.tagStyles) {
      delete this.tagStyles[tag]

      this._needsUpdate = true
      this.updateIfShould(skipUpdate)

      return true
    }
    return false
  }

  public get defaultStyle(): TextStyleExtended {
    return this.tagStyles?.default
  }

  /**
   * Alternative implicit setter for defaultStyle. Always uses default for skipUpdate.
   */
  public set defaultStyle(defaultStyles: TextStyleExtended) {
    this.setDefaultStyle(defaultStyles)
  }

  /**
   * Setter for default styles. A shortcut to this.setStyleForTag("default",...)
   * @param defaultStyles A style object to use as the default styles for all text in the component.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the styles.
   * When true, setDefaultStyle() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public setDefaultStyle(
    defaultStyles: TextStyleExtended,
    skipUpdate?: boolean,
  ): void {
    this.setStyleForTag(DEFAULT_KEY, defaultStyles, skipUpdate)
  }

  // References to internal elements.
  private _textFields: TextType[] = []
  public get textFields(): TextType[] {
    return this._textFields
  }

  private _sprites: PIXI.Sprite[] = []
  public get sprites(): PIXI.Sprite[] {
    return this._sprites
  }

  private _decorations: PIXI.Graphics[] = []
  public get decorations(): PIXI.Graphics[] {
    return this._decorations
  }

  private _spriteTemplates: ImageMap = {}
  public get spriteTemplates(): ImageMap {
    return this._spriteTemplates
  }

  private _debugGraphics: PIXI.Graphics

  // Containers for children
  private _textContainer: PIXI.Container
  public get textContainer(): PIXI.Container {
    return this._textContainer
  }

  private _decorationContainer: PIXI.Container
  public get decorationContainer(): PIXI.Container {
    return this._decorationContainer
  }

  private _spriteContainer: PIXI.Container
  public get spriteContainer(): PIXI.Container {
    return this._spriteContainer
  }

  private _debugContainer: PIXI.Container
  public get debugContainer(): PIXI.Container {
    return this._debugContainer
  }

  private logWarning = (code: string, message: string): void =>
    _logWarning(
      this.options.errorHandler,
      this.options.supressConsole,
      this,
    )(code, message)

  constructor(
    text = '',
    tagStyles: TextStyleSet = {},
    options: TaggedTextOptions = {},
    texture?: PIXI.Texture,
  ) {
    super(texture)

    this._textContainer = new PIXI.Container()
    this._spriteContainer = new PIXI.Container()
    this._decorationContainer = new PIXI.Container()
    this._debugContainer = new PIXI.Container()
    this._debugGraphics = new PIXI.Graphics()

    this.resetChildren()

    const mergedOptions = { ...DEFAULT_OPTIONS, ...options }
    this._options = mergedOptions

    tagStyles = { default: {}, ...tagStyles }

    if (this.options.wrapEmoji) {
      const userStyles = tagStyles[EMOJI_TAG]
      tagStyles[EMOJI_TAG] = {
        fontFamily: 'sans-serif',
        ...userStyles,
      }
    }
    const mergedDefaultStyles = { ...DEFAULT_STYLE, ...tagStyles.default }
    tagStyles.default = mergedDefaultStyles
    this.tagStyles = tagStyles

    if (this.options.imgMap) {
      this.createSpriteTemplatesFromSourceMap(this.options.imgMap)
    }

    this.text = text
  }

  public destroyImgMap(): void {
    if (this.destroyed) {
      throw new Error(
        'destroyImgMap() was called after this object was already destroyed. You must call destroyImgMap() before destroy() because imgMap is cleared when the object is destroyed.',
      )
    }

    this._spriteContainer.destroy({
      children: true,
      texture: true,
    })
  }

  public destroy(options?: boolean | PIXI.DestroyOptions): void {
    let destroyOptions: PIXI.DestroyOptions = {}
    if (typeof options === 'boolean') {
      options = { children: options }
    }
    destroyOptions = { ...DEFAULT_DESTROY_OPTIONS, ...options }

    // Do not destroy the sprites in the imgMap.
    this._spriteContainer.destroy(false)

    super.destroy(destroyOptions)

    this._textFields = []
    this._sprites = []
    this._decorations = []
    this._spriteTemplates = {}
    this._tokens = []
    this._tagStyles = {}
    this._options.imgMap = {}
    this._options.skipUpdates = true
    this._options.skipDraw = true
    this._options = {}
  }

  /**
   * Removes all PIXI children from this component's containers.
   * Deletes references to sprites and text fields.
   */
  protected resetChildren() {
    if (this._textContainer) {
      this._textContainer.removeChildren()
      this.removeChild(this._textContainer)
    }
    this._textContainer = new PIXI.Container()
    this.addChild(this._textContainer)

    if (this._spriteContainer) {
      this._spriteContainer.removeChildren()
      this.removeChild(this._spriteContainer)
    }
    this._spriteContainer = new PIXI.Container()
    this.addChild(this._spriteContainer)

    if (this._decorationContainer) {
      this._decorationContainer.removeChildren()
      this.removeChild(this._decorationContainer)
    }
    this._decorationContainer = new PIXI.Container()
    this.addChild(this._decorationContainer)

    if (this._debugContainer) {
      this._debugContainer.removeChildren()
      this.removeChild(this._debugContainer)
    }
    this._debugContainer = new PIXI.Container()
    this.addChild(this._debugContainer)

    this._textFields = []
    this._sprites = []
    this._decorations = []
  }

  /**
   * Creates associations between string-based keys like "img" and
   * image Sprite objects which are included in the text.
   * @param imgMap
   */
  protected createSpriteTemplatesFromSourceMap(imgMap: ImageSourceMap) {
    this._spriteTemplates = {}

    Object.entries(imgMap).forEach(([key, spriteSource]) => {
      const wrongFormatError = new TypeError(
        `The spriteSource provided for key ${key} was not in a valid format. Please use a Sprite, Texture, BaseTexture, string, HTMLImageElement, HTMLVideoElement, HTMLCanvasElement, or SVGElement`,
      )
      const destroyedError = new Error(
        `The spriteSource provided for key ${key} appears to be a Sprite or Texture that has been destroyed or removed from PIXI.TextureCache probably using \`destroy()\` with aggressive options or \`destroyImgMap()\`.`,
      )
      let error: Error | null = null

      let sprite: PIXI.Sprite = new PIXI.Sprite()

      try {
        if (spriteSource instanceof PIXI.Sprite) {
          sprite = spriteSource
        }
        // if the entry is not a sprite, attempt to load the sprite as if it is a reference to the sprite source (e.g. an Image element, url, or texture).
        else if (isSpriteSource(spriteSource)) {
          sprite = PIXI.Sprite.from(spriteSource)
        }
        else if (isTextureSource(spriteSource)) {
          sprite = PIXI.Sprite.from(PIXI.Texture.from(spriteSource))
        }
        else {
          error = wrongFormatError
          console.log(error)
        }
      }
      catch (e) {
        error = e as Error
        console.log(error)
      }

      if (
        (isSpriteSource(spriteSource)
        && (spriteSource as PIXI.Texture).baseTexture === null)
        || (sprite !== undefined
        && (sprite.destroyed || sprite.texture?.baseTexture === null))
      ) {
        error = destroyedError
        console.log(error)
      }

      if (error) {
        throw error
      }

      // Listen for changes to sprites (e.g. when they load.)
      const texture = sprite.texture

      const onTextureUpdate = (baseTexture: PIXI.Texture) => {
        this.onImageTextureUpdate(baseTexture)
        baseTexture.removeListener('update', onTextureUpdate)
      }

      texture.baseTexture.addListener('update', onTextureUpdate)

      this.spriteTemplates[key] = sprite

      // create a style for each of these by default.
      const existingStyle = this.getStyleForTag(key) ?? {}
      const style = { [IMG_REFERENCE_PROPERTY]: key, ...existingStyle }
      this.setStyleForTag(key, style)
    })
  }

  private onImageTextureUpdate(_baseTexture: PIXI.Texture): void {
    this._needsUpdate = true
    this._needsDraw = true
    this.updateIfShould()
  }

  /**
   * Determines whether to call update based on the parameter and the options set then calls it or sets needsUpdate to true.
   * @param forcedSkipUpdate This is the parameter provided to some functions that allow you to skip the update.
   * It's factored in along with the defaults to figure out what to do.
   */
  private updateIfShould(forcedSkipUpdate?: boolean): boolean {
    if (
      forcedSkipUpdate === false
      || (forcedSkipUpdate === undefined && this.options.skipUpdates === false)
    ) {
      this.update()
      return true
    }
    return false
  }

  /**
   * Calculates styles, positioning, etc. of the text and styles and creates a
   * set of objects that represent where each portion of text and image should
   * be drawn.
   * @param skipDraw *For advanced users* overrides default for redrawing the styles.
   * When true, update() will skip the call to draw() (even if the default is false).
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public update(skipDraw?: boolean): ParagraphToken {
    // Determine default style properties
    const tagStyles = this.tagStyles
    const { splitStyle, scaleIcons } = this.options
    const spriteTemplates = this.options.imgMap && this.spriteTemplates
    // const wordWrapWidth = this.defaultStyle.wordWrap
    //   ? this.defaultStyle.wordWrapWidth
    //   : Number.POSITIVE_INFINITY;
    // const align = this.defaultStyle.align;
    // const lineSpacing = this.defaultStyle.lineSpacing;

    // Pre-process text.
    // Parse tags in the text.
    const tagTokensNew = parseTagsNew(
      this.text,
      Object.keys(this.tagStyles),
      this.options.wrapEmoji,
      this.logWarning,
    )
    // Assign styles to each segment.
    const styledTokens = mapTagsToStyles(
      tagTokensNew,
      tagStyles,
      spriteTemplates,
    )
    // Measure font for each style
    // Measure each segment
    // Create the text segments, position and add them. (draw)
    const newFinalTokens = calculateTokens(
      styledTokens,
      splitStyle,
      scaleIcons,
      this.options.adjustFontBaseline,
    )

    this._tokens = newFinalTokens
    this._needsDraw = true

    // Wait one frame to draw so that this doesn't happen multiple times in one frame.
    // if (this.animationRequest) {
    //   window.cancelAnimationFrame(this.animationRequest);
    // }
    // this.animationRequest = window.requestAnimationFrame(

    this.drawIfShould(skipDraw)

    if (this.options.debugConsole) {
      console.log(this.toDebugString())
    }

    this._needsUpdate = false

    return newFinalTokens
  }

  /**
   * Determines whether to call draw() based on the parameter and the options set then calls it or sets needsDraw to true.
   * @param forcedSkipDraw This is the parameter provided to some functions that allow you to skip the update.
   * It's factored in along with the defaults to figure out what to do.
   */
  private drawIfShould(forcedSkipDraw?: boolean): boolean {
    if (
      forcedSkipDraw === false
      || (forcedSkipDraw === undefined && this.options.skipDraw === false)
    ) {
      this.draw()
      return true
    }

    return false
  }

  /**
   * Create and position the display objects based on the tokens.
   */
  public draw(): void {
    this.resetChildren()
    if (this.textContainer === null || this.spriteContainer === null) {
      throw new Error(
        'Somehow the textContainer or spriteContainer is null. This shouldn\'t be possible. Perhaps you\'ve destroyed this object?',
      )
    }
    const textContainer = this.textContainer
    const spriteContainer = this.spriteContainer

    const { drawWhitespace } = this.options
    const tokens = drawWhitespace
      ? this.tokensFlat
      : this.tokensFlat.filter(isNotWhitespaceToken) // remove any tokens that are purely whitespace unless drawWhitespace is specified

    let drewDecorations = false
    let displayObject: PIXI.Container

    tokens.forEach((t) => {
      if (isTextToken(t)) {
        displayObject = this.createTextFieldForToken(t as TextSegmentToken)
        textContainer.addChild(displayObject)
        this.textFields.push(displayObject as TextType)

        if (t.textDecorations && t.textDecorations.length > 0) {
          for (const d of t.textDecorations) {
            const drawing = this.createDrawingForTextDecoration(d);
            (displayObject as TextType).addChild(drawing)
            this._decorations.push(drawing)
          }
          drewDecorations = true
        }
      }
      if (isSpriteToken(t)) {
        displayObject = t.content as PIXI.Sprite

        this.sprites.push(displayObject as PIXI.Sprite)
        spriteContainer.addChild(displayObject)
      }

      const { bounds } = t
      displayObject.x = bounds.x
      displayObject.y = bounds.y
    })

    if (drawWhitespace === false && drewDecorations) {
      this.logWarning(
        'text-decoration-and-whitespace',
        'Text decorations, such as underlines, will not appear under whitespace unless the `drawWhitespace` option is set to `true`.',
      )
    }

    if (this.options.debug) {
      this.drawDebug()
    }
    this._needsDraw = false
  }

  protected createDrawingForTextDecoration(
    textDecoration: TextDecorationMetrics,
  ): PIXI.Graphics {
    const { overdrawDecorations: overdraw = 0 } = this.options
    const { bounds } = textDecoration
    let { color } = textDecoration
    const drawing = new PIXI.Graphics()

    if (typeof color === 'string') {
      if (color.indexOf('#') === 0) {
        color = `0x${color.substring(1)}`
        color = Number.parseInt(color, 16) as number
      }
      else {
        this.logWarning(
          'invalid-color',
          'Sorry, at this point, only hex colors are supported for textDecorations like underlines. Please use either a hex number like 0x66FF33 or a string like \'#66FF33\'',
        )
      }
    }

    // the min , max here prevents the overdraw from producing a negative width drawing.
    const { y, height } = bounds
    const midpoint = bounds.x + bounds.width / 2
    const x = Math.min(bounds.x - overdraw, midpoint)
    const width = Math.max(bounds.width + overdraw * 2, 0)

    drawing
      .beginFill(color as number)
      .drawRect(x, y, width, height)
      .endFill()

    return drawing
  }

  protected createTextField(text: string, style: TextStyleExtended): TextType {
    return new PIXI.Text({
      text,
      style: style as Partial<PIXI.TextStyleOptions>,
    }) as TextType
  }

  protected createTextFieldForToken(token: TextSegmentToken): TextType {
    const { textTransform = '' } = token.style

    let text = token.content
    switch (textTransform.toLowerCase()) {
      case 'lowercase':
        text = text.toLowerCase()
        break
      case 'uppercase':
        text = text.toUpperCase()
        break
      case 'capitalize':
        text = capitalize(text)
        break
      default:
    }

    const alignClassic = convertUnsupportedAlignment(token.style.align)
    const sanitizedStyle = {
      ...token.style,
      align: alignClassic,
    } as TextStyleExtended

    const textField = this.createTextField(text, sanitizedStyle) as PIXI.Text

    let { fontScaleWidth = 1.0, fontScaleHeight = 1.0 } = token.style
    fontScaleWidth
      = Number.isNaN(fontScaleWidth) || fontScaleWidth < 0 ? 0 : fontScaleWidth
    fontScaleHeight
      = Number.isNaN(fontScaleHeight) || fontScaleHeight < 0 ? 0 : fontScaleHeight

    let finalScaleWidth = fontScaleWidth
    let finalScaleHeight = fontScaleHeight
    const largerScale = Math.max(fontScaleWidth, fontScaleHeight)

    if (largerScale > 1) {
      if (largerScale === fontScaleHeight) {
        finalScaleWidth /= largerScale
        finalScaleHeight = 1.0
      }
      else {
        finalScaleHeight /= largerScale
        finalScaleWidth = 1.0
      }

      const fs = textField.style.fontSize ?? 0
      const fontSizePx
        = (typeof fs === 'string' ? fontSizeStringToNumber(fs) : fs)
        * largerScale

      textField.style.fontSize = fontSizePx
    }

    textField.scale.set(finalScaleWidth, finalScaleHeight)
    return textField as TextType
  }

  /**
   * Converts the text properties from this.tokens into a human readable string.
   * This is automatically logged to the console on update when debug option is set to true.
   */
  public toDebugString(): string {
    const lines = this.tokens
    let s = `${this.untaggedText}\n=====\n`
    const nl = '\n    '
    if (lines !== undefined) {
      s += lines.map((line, lineNumber) =>
        line.map((word, wordNumber) =>
          word
            .map((token, tokenNumber) => {
              let text = ''
              if (isTextToken(token)) {
                if (isNewlineToken(token)) {
                  text = `\\n`
                }
                else {
                  text = `"${token.content}"`
                }
              }
              else if (isSpriteToken(token)) {
                text = `[Image]`
              }
              let s = `\n${text}: (${lineNumber}/${wordNumber}/${tokenNumber})`
              s += `${nl}tags: ${
                token.tags.length === 0
                  ? '<none>'
                  : token.tags
                      .split(',')
                      .map((tag) => `<${tag}>`)
                      .join(', ')
              }`
              s += `${nl}style: ${Object.entries(token.style)
                .map((e) => e.join(':'))
                .join('; ')}`
              s += `${nl}size: x:${token.bounds.x} y:${token.bounds.y} width:${
                token.bounds.width
              } height:${token.bounds.height} bottom:${
                token.bounds.height + token.bounds.y
              } right:${token.bounds.x + token.bounds.width}`
              s += `${nl}font: fontSize:${token.fontProperties.fontSize} ascent:${token.fontProperties.ascent} descent:${token.fontProperties.descent}`
              return s
            })
            .join('\n'),
        ),
      )
    }
    return s
  }

  public drawDebug(): void {
    const paragraph = this.tokens
    this._debugGraphics = new PIXI.Graphics()
    if (this.debugContainer === null) {
      throw new Error(
        'Somehow the debug container is null. This shouldn\'t be possible. Perhaps you\'ve destroyed this object?',
      )
    }
    const debugContainer = this.debugContainer
    debugContainer.addChild(this._debugGraphics)

    const g = this._debugGraphics
    g.clear()

    // const { width, height } = this.getBounds();
    // // frame shadow
    // g.lineStyle(2, DEBUG.OUTLINE_SHADOW_COLOR, 0.5);
    // // g.beginFill();
    // g.drawRect(1, 1, width, height);
    // // g.endFill();

    // // frame
    // g.lineStyle(2, DEBUG.OUTLINE_COLOR, 1);
    // // g.beginFill();
    // g.drawRect(0, 0, width - 1, height - 1);
    // // g.endFill();

    function createInfoText(text: string, position: Point): PIXI.Text {
      const info = new PIXI.Text({ text, style: DEBUG.TEXT_STYLE })
      info.x = position.x + 1
      info.y = position.y + 1
      return info
    }

    // for (const line of tokens) {
    for (let lineNumber = 0; lineNumber < paragraph.length; lineNumber++) {
      const line = paragraph[lineNumber]
      const lineBounds = getBoundsNested(line)

      if (this.defaultStyle.wordWrap) {
        const w = this.defaultStyle.wordWrapWidth ?? this.width
        g.rect(0, lineBounds.y, w, lineBounds.height).stroke({
          width: 0.5,
          color: DEBUG.LINE_COLOR,
          alpha: 0.2,
        })
      }

      for (let wordNumber = 0; wordNumber < line.length; wordNumber++) {
        const word = line[wordNumber]
        for (const segmentToken of word) {
          const isSprite = isSpriteToken(segmentToken)
          const { x, y, width } = segmentToken.bounds
          const baseline
            = y
            + (isSprite
              ? segmentToken.bounds.height
              : segmentToken.fontProperties.ascent)

          let { height } = segmentToken.bounds
          if (isSprite) {
            height += segmentToken.fontProperties.descent
          }

          if (
            isWhitespaceToken(segmentToken)
            && this.options.drawWhitespace === false
          ) {
            g.stroke({
              width: 1,
              color: DEBUG.WHITESPACE_STROKE_COLOR,
              alpha: 1,
            }).fill({ color: DEBUG.WHITESPACE_COLOR, alpha: 0.2 })
          }
          else {
            g.stroke({
              width: 1,
              color: DEBUG.WHITESPACE_STROKE_COLOR,
              alpha: 1,
            }).fill({ color: DEBUG.WORD_FILL_COLOR, alpha: 0.2 })
          }

          if (isNewlineToken(segmentToken)) {
            this.debugContainer.addChild(
              createInfoText('↩︎', { x, y: y + 10 }),
            )
          }
          else {
            g.rect(x, y, width, height).stroke({
              width: 0.5,
              color: DEBUG.LINE_COLOR,
              alpha: 0.2,
            }).fill().rect(x, baseline, width, 1).stroke({
              width: 1,
              color: DEBUG.BASELINE_COLOR,
              alpha: 1,
            })
          }

          let info
          // info = `${token.bounds.width}⨉${token.bounds.height}`;
          if (isTextToken(segmentToken)) {
            // info += ` ${token.tags}`;
            info = `${segmentToken.tags}`
            this.debugContainer.addChild(createInfoText(info, { x, y }))
          }
          // this.debugContainer.addChild(createInfoText(info, { x, y }));
        }
      }
    }
    // }

    // Show the outlines of the actual text fields,
    // not just where the tokens say they should be
    // const fields: PIXI.Text[] = this.textFields;
    // for (const text of fields) {
    //   g.lineStyle(1, DEBUG.TEXT_FIELD_STROKE_COLOR, 1);
    //   g.drawRect(text.x, text.y, text.width, text.height);
    // }
  }
}
