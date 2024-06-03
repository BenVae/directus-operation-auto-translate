// import OpenAI from 'openai';

export default {
  id: "openai-auto-translate",
  handler: async (
    { item_ids, collection, language_table },
    { env, services, getSchema }
  ) => {
    const OpenAIService = require("openai");

    if (env.OPENAI_API_KEY == undefined) return "API Key not defined";
    if (env.OPENAI_RATE_LIMIT == undefined) return "API Key not defined";

    const openai = new OpenAIService({
      apiKey: env.OPENAI_API_KEY,
    });

    const output = [];
    const errors = [];

    const { ItemsService } = services;
    const schema = await getSchema();
    const translations = new ItemsService(`${collection}_translations`, {
      schema: schema,
    });
    const languages = new ItemsService(language_table, { schema: schema });

    for (let i = 0; i < item_ids.length; i++) {
      await translations
        .readByQuery({
          fields: ["*"],
          filter: { [`${collection}_id`]: { _eq: item_ids[i] } },
        })
        .then((items) => {
          if (items[0] == undefined) return "No initial sample found.";

          languages
            .readByQuery({
              fields: ["code", "name"],
              filter: { code: { _neq: items[0].languages_code } },
            })
            .then(async (langs) => {
              let translation_item = items[0];
              delete translation_item["id"];

              const json_sample = translation_item;

              if (langs.length === 0) return "No languages found in table.";

              for (let i = 0; i < langs.length; i++) {
                // if translation for this language already exists, skip
                if (
                  items.filter((item) => item.languages_code === langs[i].code)
                    .length > 0
                )
                  continue;
                await openapi_call(i, langs[i], json_sample);
              }

              await delay(langs.length * env.OPENAI_RATE_LIMIT).then(() => {
                console.log(output);
                console.log(errors);
                if (errors.length > 0) return errors;
                return output;
              });
            });
        });
    }

    async function openapi_call(i, lang, json_sample) {
      await delay(i * env.OPENAI_RATE_LIMIT).then(() => {
        openai.chat.completions
          .create({
            messages: [
              {
                role: "system",
                content:
                  "You will be provided a JSON document and your task is to translate it into " +
                  lang.name +
                  ". You must answer with a valid JSON. Dont change the structure of the JSON. Only change the values. And please double check that the JSON is valid.",
              },
              { role: "user", content: JSON.stringify(json_sample) },
            ],
            model: "gpt-3.5-turbo",
          })
          .then((openai_response) => {
            //console.log(openai_response);
            if (openai_response == undefined) return;
            let translated_data = JSON.parse(
              openai_response.choices[0].message.content.replace('\\"', '"')
            );
            translated_data.languages_code = lang.code;
            //console.log(translated_data);
            translations
              .createOne(translated_data)
              .then((create_response) => {
                //console.log(create_response);
                output.push(create_response);
                return;
              })
              .catch((error) => {
                console.log(error);
                errors.push(error);
                return;
              });
          })
          .catch((error) => {
            console.log(error);
            errors.push(error);
            return;
          });
      });
    }

    async function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  },
};
