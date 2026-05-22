require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors()); // Permite que o frontend se conecte com o backend
app.use(express.json());

// Configuração do Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Configuração do Multer (recebe a imagem e guarda na memória, não no disco)
const upload = multer({ storage: multer.memoryStorage() });

// ROTA 1: Listar as promoções ativas (Para o portal do cliente e admin)
app.get('/api/promocoes', async (req, res) => {
    const { data, error } = await supabase
        .from('promocoes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
});

// ROTA 2: Cadastrar nova promoção com imagem (Para o Admin)
app.post('/api/promocoes', upload.single('imagem'), async (req, res) => {
    try {
        const { titulo, descricao, link_destino, ativa } = req.body;
        const imagem = req.file;

        if (!imagem) {
            return res.status(400).json({ erro: 'Nenhuma imagem enviada.' });
        }

        // 1. Processar a imagem com Sharp (Corta para 500x500 e converte para WebP para ficar leve)
        const imagemProcessada = await sharp(imagem.buffer)
            .resize(500, 500, { fit: 'cover' }) // 'cover' garante que preencha os 500x500 sem distorcer
            .webp({ quality: 80 })
            .toBuffer();

        // 2. Criar um nome único para o arquivo
        const nomeArquivo = `${Date.now()}-${Math.round(Math.random() * 1E9)}.webp`;

        // 3. Subir a imagem processada para o Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('imagens-promocoes')
            .upload(nomeArquivo, imagemProcessada, {
                contentType: 'image/webp',
                upsert: false
            });

        if (uploadError) throw uploadError;

        // 4. Pegar a URL pública da imagem que acabamos de subir
        const { data: publicUrlData } = supabase.storage
            .from('imagens-promocoes')
            .getPublicUrl(nomeArquivo);

        const urlImagemPublica = publicUrlData.publicUrl;

        // 5. Salvar os dados no Banco de Dados PostgreSQL
        const { data: dbData, error: dbError } = await supabase
            .from('promocoes')
            .insert([
                {
                    titulo,
                    descricao,
                    link_destino,
                    url_imagem: urlImagemPublica,
                    ativa: ativa === 'true' || ativa === true
                }
            ])
            .select();

        if (dbError) throw dbError;

        res.status(201).json({ mensagem: 'Promoção cadastrada com sucesso!', dados: dbData });

    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Erro ao processar a promoção.', detalhe: erro.message });
    }
});

// ROTA 3: Excluir uma promoção (Para o Admin)
app.delete('/api/promocoes/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Primeiro, busca a promoção para pegar o link da imagem e poder deletá-la do Storage
        const { data: promo } = await supabase.from('promocoes').select('url_imagem').eq('id', id).single();
        
        if (promo && promo.url_imagem) {
            // Extrai o nome do arquivo da URL completa
            const nomeArquivo = promo.url_imagem.split('/').pop();
            await supabase.storage.from('imagens-promocoes').remove([nomeArquivo]);
        }

        // Deleta o registro do banco de dados
        const { error } = await supabase.from('promocoes').delete().eq('id', id);
        
        if (error) throw error;
        res.json({ mensagem: 'Promoção excluída com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao excluir promoção.' });
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});