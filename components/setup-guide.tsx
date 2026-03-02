"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { Info, Lightbulb, Target, Server, ChevronDown, ChevronRight ,TableOfContents} from "lucide-react"

export function SetupGuide() {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-blue-800">
            <Server className="h-5 w-5" />
            如何阅读这张结构图?
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-blue-700 hover:text-blue-900"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {isExpanded ? "隐藏" : "显示"} 说明
          </Button>
        </div>
      </CardHeader>
      {isExpanded && (
      <CardContent className="space-y-3">
        <Alert>
          <Target className="h-4 w-4" />
          <AlertDescription>
          点击下方结构图中的各个部分，可以查看详细反馈和改进建议。
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 gap-4 text-sm">
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <Lightbulb className="h-3 w-3" />
              Color Legend
            </h4>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-800 border-green-200">Effective（绿色）有效</Badge>
                <span className="text-xs">论证清晰有力。该部分完整、解释清楚，并有充分证据支持。</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Adequate（黄色）基本有效</Badge>
                <span className="text-xs">内容存在，但可以更好。可能有细节不清楚，或证据不够充分。</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-red-100 text-red-800 border-red-200">Ineffective（红色）需要改进</Badge>
                <span className="text-xs">表达不清楚，缺少证据支持，或没有清楚地帮助你的论点。</span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-white rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <TableOfContents className="h-4 w-4 text-blue-600" />
                <h4 className="font-medium">论证要素说明:</h4>
              </div>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-2">
                <li><strong>Lead（开头）:</strong> 文章的第一句话。应该吸引读者注意，并介绍主题。</li>
                <li><strong>Position（立场）:</strong>你对题目的主要回答。应该清楚、直接，相当于你的中心论点。</li>
                <li><strong>Claim（论点）:</strong>支持你立场的一个理由。应该具体、相关。</li>
                <li><strong>Counterclaim（反方观点）:</strong>与您立场相反的观点。应该合理，并对你的立场提出挑战。</li>
                <li><strong>Rebuttal（反驳）:</strong> 你对反方观点的回应。应该清楚说明为什么对方观点不正确。</li>
                <li><strong>Evidence（证据）:</strong>支持论点的事实、例子或数据。应该相关、客观。</li>
                <li><strong>Conclusion（结论）:</strong> 总结主要观点，并再次有力地重申你的立场。</li>
            </ul>
            </div>

          
        </div>
      </CardContent>
      )}
      </Card>
    )
  }
  