'use client';
import {rows,object,textValue,type RecordData} from './adapter';

// A read projection, never a new canonical document or an implicit migration.
// Deliberately allowlist narrative fields: visual/runtime metadata remains in the original flow.
export function NarrativeUnits({episode}:{episode:RecordData}){
 const flow=object(episode.playFlow),nodes=rows(flow.nodes);
 return <section aria-label="스토리 단위 메타데이터"><h4>스토리 단위 · {nodes.length}개</h4>
 <p className="meta">기존 장면 ID와 분기 연결을 유지한 읽기 전용 보기입니다. 원본 수정은 기존 정식 스토리 요청을 사용합니다.</p>
 {!nodes.length&&<p>아직 등록된 스토리 단위가 없습니다.</p>}
 {nodes.map((node,index)=><article className="story-choice-info" key={String(node.id||index)}>
 <h5>{textValue(node.title)||String(node.id)}</h5><p className="meta">{String(node.id)} · {textValue(node.kind)}</p>
 {node.speaker&&<strong>{textValue(node.speaker)}</strong>}{node.body&&<p className="preserve-text">{textValue(node.body)}</p>}
 {rows(node.lines).map((line,i)=><p className="preserve-text" key={i}>{line.speaker&&<strong>{textValue(line.speaker)} · </strong>}{textValue(line.text||line.body)}</p>)}
 {rows(object(node.encounter).actors).map((actor,i)=><details key={'dialogue'+i}><summary>대화 · {textValue(actor.name)}</summary>{rows(actor.dialogue).map((turn,j)=><p className="preserve-text" key={j}><strong>{turn.speaker===object(object(node.encounter).protagonist).npcId?textValue(object(object(node.encounter).protagonist).name):textValue(actor.name)} · </strong>{textValue(turn.text)}</p>)}</details>)}
 {rows(object(node.cinematic).frames).length>0&&<details><summary>장면 속 서술·독백</summary>{rows(object(node.cinematic).frames).map((frame,i)=><p className="preserve-text" key={i}>{frame.speaker&&<strong>{textValue(frame.speaker)} · </strong>}{textValue(frame.text)}</p>)}</details>}
 {rows(node.variants).length>0&&<details><summary>조건별 서술 · {rows(node.variants).length}개</summary>{rows(node.variants).map((variant,i)=><p className="preserve-text" key={i}>{textValue(variant.body)}</p>)}</details>}
 {rows(node.choices).length>0&&<ul>{rows(node.choices).map((choice,i)=><li key={String(choice.id||i)}><strong>{textValue(choice.label||choice.title)}</strong><small> → {String(choice.nextNodeId||choice.next||choice.target||'원본 연결 참조')}</small></li>)}</ul>}
 </article>)}
 </section>;
}
