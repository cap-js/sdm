using { Attachments} from '@cap-js/attachments';
extend aspect Attachments with {
    folderId : String @title: 'Folder ID';
};

annotate Attachments with @UI:{
  HeaderInfo: {
    TypeName: '{i18n>Attachment}',
    TypeNamePlural: '{i18n>Attachments}',
  },
  LineItem: [
    {Value: filename},
    {Value: content},
    {Value: status},
    {Value: createdAt},
    {Value: createdBy},
    {Value: note}
  ]
} {
  content
    @Core.ContentDisposition: { Filename: filename }
    @Core.Immutable
}