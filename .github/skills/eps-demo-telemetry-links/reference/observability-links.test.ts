// Reference tests for observability-links.ts. Adapt to your test runner (Vitest shown).
import { describe, expect, it } from 'vitest'
import {
  answerReviewWorkbookUrl, answerStepsKql, appInsightsLogsUrl, conversationKql, isConversationId, isTraceId,
  logsQueryUrl, windowAround, type ObservabilityConfig,
} from './observability-links'

const config: ObservabilityConfig = {
  portalOrigin: 'https://portal.azure.com',
  tenantId: '00000000-0000-0000-0000-000000000001',
  appInsightsResourceId: '/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-demo/providers/microsoft.insights/components/appi-demo',
  answerReviewWorkbookId: '/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-demo/providers/microsoft.insights/workbooks/00000000-0000-0000-0000-000000000003',
}
const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

describe('review IDs', () => {
  it('accepts only real recorded IDs, so nothing can break out of a query', () => {
    expect(isTraceId(traceId)).toBe(true)
    expect(isTraceId('0'.repeat(32))).toBe(false)
    expect(isTraceId('replay-1234')).toBe(false)
    expect(isTraceId(`${traceId}" or true`)).toBe(false)
    expect(isConversationId('3f2c7b1e-9a4d-4c8e-b5f0-2d6e8a1c4b7f')).toBe(true)
    expect(isConversationId('conv_0a1b2c3d4e5f6a7b8c9dExampleOnly')).toBe(true)
    for (const bad of ['x" | take 1', 'a b c d e f g h', "conv_'1'", 'conv\\1234567', '']) {
      expect(isConversationId(bad), bad).toBe(false)
      expect(() => conversationKql(bad)).toThrow()
    }
    expect(() => answerStepsKql('not-a-trace')).toThrow()
  })

  it('puts the ID into the query as a plain string', () => {
    expect(answerStepsKql(traceId)).toContain(`let traceId = "${traceId}";`)
    expect(conversationKql('conv_12345678')).toContain('let conversationId = "conv_12345678";')
  })

  it('builds portal links only for the configured resources', async () => {
    expect(appInsightsLogsUrl(config)).toBe(
      `https://portal.azure.com/#@${config.tenantId}/resource${config.appInsightsResourceId}/logs`,
    )
    expect(answerReviewWorkbookUrl(config)).toBe(
      `https://portal.azure.com/#@${config.tenantId}/resource${config.answerReviewWorkbookId}/workbook`,
    )
    expect(answerReviewWorkbookUrl({ ...config, answerReviewWorkbookId: undefined })).toBeNull()
    expect(() => appInsightsLogsUrl({ ...config, portalOrigin: 'http://portal.azure.com' })).toThrow()
    expect(() => appInsightsLogsUrl({ ...config, appInsightsResourceId: 'https://evil.example' })).toThrow()

    const window = windowAround(['2026-10-01T01:36:15.000Z'])
    expect(window).toEqual({ from: '2026-10-01T00:36:15.000Z', to: '2026-10-01T02:36:15.000Z' })
    const link = await logsQueryUrl(config, answerStepsKql(traceId), window)
    expect(link.startsWith(`https://portal.azure.com/#@${config.tenantId}/blade/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView/resourceId/`)).toBe(true)
    expect(link).toContain(encodeURIComponent('2026-10-01T00:36:15.000Z/2026-10-01T02:36:15.000Z'))

    // The q segment is base64(gzip(query)) and decodes back to the exact KQL.
    const encoded = decodeURIComponent(link.split('/q/')[1].split('/timespan/')[0])
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    const text = await new Response(new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))).text()
    expect(text).toBe(answerStepsKql(traceId))
  })
})
