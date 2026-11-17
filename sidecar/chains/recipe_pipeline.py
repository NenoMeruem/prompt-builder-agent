"""
Recipe Pipeline Engine using LangChain Expression Language (LCEL).
Supports single prompt execution and multi-step chained prompt workflows with real-time streaming.
Directly utilizes Engine/Provider, Model, and API keys provided in the request.
"""

import json
from typing import AsyncGenerator, Dict, Any, List, Optional
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from sidecar.llm_factory import get_chat_model
from sidecar.schemas import RecipeChainRequest, RecipeStep


def inject_variables_and_params(template: str, selection: str, params: Dict[str, Any]) -> str:
    """Replaces {{selection}} and other context variables with actual values."""
    rendered = template.replace("{{selection}}", str(selection))
    for k, v in params.items():
        rendered = rendered.replace(f"{{{{{k}}}}}", str(v))

    # Append tone / length / complexity directives if provided
    directives = []
    if "tone" in params and params["tone"]:
        directives.append(f"Use a {params['tone']} tone.")
    if "length" in params and params["length"]:
        directives.append(f"Keep the output {params['length']}.")
    if "complexity" in params and params["complexity"]:
        directives.append(f"Target complexity: {params['complexity']}.")

    if directives:
        rendered += "\n\n[" + " ".join(directives) + "]"

    return rendered


async def execute_single_recipe(
    template: str,
    selection: str,
    parameters: Dict[str, Any],
    provider: str = "gemini",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Executes a single recipe with LCEL and streams chunk tokens.
    """
    final_prompt_text = inject_variables_and_params(template, selection, parameters)
    llm = get_chat_model(provider=provider, model=model, api_key=api_key, streaming=True)
    prompt = ChatPromptTemplate.from_messages([("human", "{user_input}")])
    chain = prompt | llm | StrOutputParser()

    async for chunk in chain.astream({"user_input": final_prompt_text}):
        yield chunk


async def execute_recipe_pipeline(
    request: RecipeChainRequest,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Executes a multi-step or single-step recipe pipeline, yielding SSE events.
    """
    request_api_key = request.api_key or request.parameters.get("api_key")
    request_provider = request.provider or request.parameters.get("provider", "gemini")
    request_model = request.model or request.parameters.get("model", None)

    # Case 1: Custom multi-step pipeline provided
    if request.steps and len(request.steps) > 0:
        total = len(request.steps)
        print(f"[recipe_pipeline] 🚀 Starting pipeline with {total} steps for recipe '{request.recipe_id}'")
        yield {"event": "status", "data": {"message": f"Executing multi-step pipeline ({total} steps)..."}}
        
        context_vars = {"selection": request.selection, **request.parameters}

        for idx, step in enumerate(request.steps):
            step_num = idx + 1
            step_name = step.name or step.step_id
            step_provider = step.provider or request_provider
            step_model = step.model or request_model
            step_key = step.api_key or request_api_key

            print(
                f"[recipe_pipeline] ▶ Step {step_num}/{total}: '{step_name}' "
                f"(provider='{step_provider}', model='{step_model or 'default'}', has_key={bool(step_key)})"
            )

            yield {
                "event": "status",
                "data": {
                    "message": f"Running step {step_num}/{total}: {step_name} ({step_provider}/{step_model or 'default'})...",
                    "step_index": idx,
                    "total_steps": total,
                    "step_id": step.step_id,
                }
            }

            prompt_text = inject_variables_and_params(step.template, context_vars.get("selection", ""), context_vars)

            
            try:
                llm = get_chat_model(provider=step_provider, model=step_model, api_key=step_key, streaming=True)
                prompt = ChatPromptTemplate.from_messages([("human", "{user_input}")])
                chain = prompt | llm | StrOutputParser()

                step_output = []
                async for chunk in chain.astream({"user_input": prompt_text}):
                    step_output.append(chunk)
                    yield {
                        "event": "chunk",
                        "data": {
                            "text": chunk,
                            "step_id": step.step_id,
                            "step_index": idx,
                            "total_steps": total,
                            "step_name": step_name,
                        },
                    }


                full_step_res = "".join(step_output)
                print(f"[recipe_pipeline] ✓ Step {step_num}/{total} completed ({len(full_step_res)} chars)")
                context_vars[step.output_key] = full_step_res
                context_vars[step.step_id] = full_step_res
                # Update selection for subsequent steps if desired
                context_vars["selection"] = full_step_res

            except Exception as step_err:
                err_msg = f"Step {step_num} ({step_name}) failed: {str(step_err)}"
                print(f"[recipe_pipeline] ❌ {err_msg}")
                yield {"event": "error", "data": {"message": err_msg}}
                return

        yield {"event": "done", "data": {"status": "completed", "steps": total}}

    # Case 2: Single recipe fallback
    else:
        print(f"[recipe_pipeline] 🚀 Starting single recipe '{request.recipe_id}' with provider='{request_provider}', model='{request_model or 'default'}'")
        yield {"event": "status", "data": {"message": f"Processing recipe with {request_provider} ({request_model or 'default'})..."}}
        template = request.parameters.get("template", "{{selection}}")


        async for chunk in execute_single_recipe(
            template,
            request.selection,
            request.parameters,
            provider=request_provider,
            model=request_model,
            api_key=request_api_key,
        ):
            yield {"event": "chunk", "data": {"text": chunk}}

        yield {"event": "done", "data": {"status": "completed"}}
