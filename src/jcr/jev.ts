import {
  choice,
  TypeSafeClient,
  type ChoiceQuestion,
  type EntryType,
} from "@typesafe-ai/sdk";
import type { CapabilitySelection } from "./types.js";

const noneId = "__none__";
export const directChoiceLimit = 240;
const finalistCount = 3;

export type JevState = EntryType;

export type JevOption = {
  id: string;
  name: string;
  description: string;
};

export type JevChoice = {
  selected?: CapabilitySelection;
  alternatives: CapabilitySelection[];
};

export type JevQuestion = {
  instructions: string;
  options: JevOption[];
};

export type JevDistribution = {
  selectedId?: string;
  confidence: number;
  probabilities: Map<string, number>;
  noneProbability: number;
};

type ChoiceAnswer = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

const emptyDistribution = (): JevDistribution => ({
  confidence: 0,
  probabilities: new Map(),
  noneProbability: 1,
});

const rankedOptions = (
  distribution: JevDistribution,
  options: Map<string, JevOption>,
): JevOption[] =>
  [...distribution.probabilities]
    .filter(([id]) => options.has(id))
    .sort(([, left], [, right]) => right - left)
    .map(([id]) => options.get(id)!);

export class JevClient {
  private readonly client: TypeSafeClient;
  private requests = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor() {
    this.client = new TypeSafeClient({
      defaultModel: process.env.TYPESAFE_MODEL ?? "jev-latest",
    });
  }

  get usage(): {
    requests: number;
    inputTokens: number;
    outputTokens: number;
  } {
    return {
      requests: this.requests,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }

  private async askBatch(
    state: JevState,
    questionsToAsk: JevQuestion[],
  ): Promise<JevDistribution[]> {
    if (questionsToAsk.length === 0) return [];
    const questions: Record<string, ChoiceQuestion> = {};
    const optionMaps = new Map<
      string,
      {
        byKey: Map<string, JevOption>;
        byId: Map<string, JevOption>;
      }
    >();
    questionsToAsk.forEach((question, index) => {
      const id = `choice_${index}`;
      const byKey = new Map<string, JevOption>();
      const byId = new Map<string, JevOption>();
      const criteria = Object.fromEntries(
        question.options.map((option, optionIndex) => {
          if (byId.has(option.id)) {
            throw new Error(`Duplicate Jev option id: ${option.id}`);
          }
          const key = `option_${optionIndex}`;
          byKey.set(key, option);
          byId.set(option.id, option);
          return [
            key,
            {
              name: option.name,
              description: option.description,
            },
          ];
        }),
      );
      optionMaps.set(id, { byKey, byId });
      questions[id] = choice(question.instructions, {
        ...criteria,
        [noneId]: "None of these options fits the requested step.",
      });
    });
    const response = await this.client.systemOne({
      state,
      questions,
    });
    this.requests += 1;
    this.inputTokens += response.usage.input_tokens;
    this.outputTokens += response.usage.output_tokens;
    return questionsToAsk.map((_, index) => {
      const id = `choice_${index}`;
      const answer = response.answers[id] as ChoiceAnswer;
      const optionMap = optionMaps.get(id)!;
      const probabilities = new Map<string, number>();
      for (const [key, probability] of Object.entries(answer.probabilities)) {
        const option = optionMap.byKey.get(key);
        if (option) probabilities.set(option.id, probability);
      }
      const selected = optionMap.byKey.get(answer.choice);
      return {
        ...(selected ? { selectedId: selected.id } : {}),
        confidence: answer.confidence,
        probabilities,
        noneProbability: answer.probabilities[noneId] ?? 0,
      };
    });
  }

  async distributions(
    state: JevState,
    questions: JevQuestion[],
  ): Promise<JevDistribution[]> {
    const results = questions.map(emptyDistribution);
    const chunks: {
      questionIndex: number;
      question: JevQuestion;
    }[] = [];
    questions.forEach((question, questionIndex) => {
      for (
        let optionIndex = 0;
        optionIndex < question.options.length;
        optionIndex += directChoiceLimit
      ) {
        chunks.push({
          questionIndex,
          question: {
            instructions: question.instructions,
            options: question.options.slice(
              optionIndex,
              optionIndex + directChoiceLimit,
            ),
          },
        });
      }
    });
    const firstRound = await this.askBatch(
      state,
      chunks.map((chunk) => chunk.question),
    );
    const byQuestion = new Map<number, JevDistribution[]>();
    firstRound.forEach((distribution, index) => {
      const questionIndex = chunks[index]!.questionIndex;
      const grouped = byQuestion.get(questionIndex) ?? [];
      grouped.push(distribution);
      byQuestion.set(questionIndex, grouped);
    });
    const rerank: {
      questionIndex: number;
      question: JevQuestion;
    }[] = [];
    questions.forEach((question, questionIndex) => {
      const distributions = byQuestion.get(questionIndex) ?? [];
      if (distributions.length === 0) return;
      if (distributions.length === 1) {
        results[questionIndex] = distributions[0]!;
        return;
      }
      const options = new Map(
        question.options.map((option) => [option.id, option]),
      );
      const finalists = distributions
        .flatMap((distribution) =>
          rankedOptions(distribution, options).slice(0, finalistCount),
        )
        .filter(
          (option, index, all) =>
            all.findIndex((candidate) => candidate.id === option.id) === index,
        );
      rerank.push({
        questionIndex,
        question: {
          instructions: question.instructions,
          options: finalists,
        },
      });
    });
    const finalRound = await this.askBatch(
      state,
      rerank.map((entry) => entry.question),
    );
    finalRound.forEach((distribution, index) => {
      results[rerank[index]!.questionIndex] = distribution;
    });
    return results;
  }

  async choose(
    state: JevState,
    instructions: string,
    options: JevOption[],
  ): Promise<JevChoice> {
    if (options.length === 0) {
      return { alternatives: [] };
    }
    const [distribution] = await this.distributions(state, [
      { instructions, options },
    ]);
    if (!distribution) {
      return { alternatives: [] };
    }
    const optionsById = new Map(options.map((option) => [option.id, option]));
    const alternatives = [...distribution.probabilities]
      .filter(([id]) => optionsById.has(id))
      .sort(([, left], [, right]) => right - left)
      .slice(0, finalistCount)
      .map(([id, probability]) => ({
        id,
        name: optionsById.get(id)!.name,
        probability,
        confidence: distribution.confidence,
      }));
    const selected = distribution.selectedId
      ? alternatives.find(
          (selection) => selection.id === distribution.selectedId,
        )
      : undefined;
    return {
      ...(selected ? { selected } : {}),
      alternatives,
    };
  }
}
